"use server";

import {
  createEditorialPhoto,
  createUploadIntent,
  EDITORIAL_NAMESPACE,
  EditorialRevisionConflict,
  finalizeUpload,
  publishEditorial,
  saveEditorialDraft,
  updateEditorialTenantProfile,
  withdrawEditorial,
} from "@eia/application";
import { DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getTranslator } from "@/lib/locale";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * The three editorial acts, each behind its own permission in the use-case beneath it.
 *
 * Thin by design (ARCHITECTURE §3): validate, resolve the context, call the use-case. No
 * authorization decision is taken here — `resolveSurfaceAccess` answers 404 for a tenant or
 * project the caller cannot see, and the use-cases require `portal.editorial.write` and
 * `portal.publish` respectively.
 */
const scope = z.object({ tenant: z.string().min(1), project: z.string().min(1) });

/**
 * `revision` is the **draft's**; `profileRevision` is the tenant profile's. Two counters on two
 * rows, named apart on purpose: one field would have let a profile save quietly reset the number
 * the draft's next save is checked against.
 */
export type EditorialActionResult =
  | { ok: true; message: string; revision?: number; profileRevision?: number }
  | { ok: false; error: string };

/** The refusals a person should read, as opposed to the ones that are this product's own fault. */
function toResult(error: unknown): EditorialActionResult | null {
  if (error instanceof EditorialRevisionConflict) return { ok: false, error: error.message };
  if (error instanceof DomainError) return { ok: false, error: error.message };
  // A content refusal names what it found in the page, and nothing else about it.
  if (error instanceof Error && error.name === "EditorialContentRefused") {
    return { ok: false, error: error.message };
  }
  return null;
}

/**
 * Publishing and withdrawing change a page in a different route group, with its own cache entry.
 * Revalidating only the editor would leave a visitor reading the previous answer.
 */
function revalidateBoth(tenant: string, project: string): void {
  revalidatePath(`/t/${tenant}/p/${project}/portal/editorial`, "page");
  revalidatePath(`/p/${tenant}/${project}`, "page");
  // The landing is a third entry. Without this it keeps listing a road that was just withdrawn,
  // or keeps the firm's old name after it was changed — stale in the one place a visitor starts.
  revalidatePath(`/p/${tenant}`, "page");
}

export async function saveEditorialDraftAction(raw: unknown): Promise<EditorialActionResult> {
  const input = scope
    .extend({ expectedRevision: z.number().int().min(0), payload: z.unknown() })
    .strict()
    .parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "portal");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  try {
    const saved = await saveEditorialDraft(getDb(), access.ctx, {
      expectedRevision: input.expectedRevision,
      payload: input.payload,
    });
    revalidateBoth(input.tenant, input.project);
    return { ok: true, message: t("portal.editorial.saved"), revision: saved.revision };
  } catch (error) {
    const result = toResult(error);
    if (result) return result;
    throw error;
  }
}

export async function publishEditorialAction(raw: unknown): Promise<EditorialActionResult> {
  const input = scope
    .extend({ expectedRevision: z.number().int().min(1) })
    .strict()
    .parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "portal");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  try {
    const published = await publishEditorial(getDb(), access.ctx, {
      expectedRevision: input.expectedRevision,
    });
    revalidateBoth(input.tenant, input.project);
    return {
      ok: true,
      message: t("portal.editorial.published", { version: String(published.sequence) }),
    };
  } catch (error) {
    const result = toResult(error);
    if (result) return result;
    throw error;
  }
}

export async function withdrawEditorialAction(raw: unknown): Promise<EditorialActionResult> {
  const input = scope
    .extend({ reason: z.string().min(8) })
    .strict()
    .parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "portal");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  try {
    await withdrawEditorial(getDb(), access.ctx, { reason: input.reason });
    revalidateBoth(input.tenant, input.project);
    return { ok: true, message: t("portal.editorial.withdrawn") };
  } catch (error) {
    const result = toResult(error);
    if (result) return result;
    throw error;
  }
}

/* ---------------------------------------------------------------------------------------------
 * Uploading an editorial file
 * ------------------------------------------------------------------------------------------ */

/**
 * The same three steps every upload in this product takes — intent, PUT, finalize — with one
 * more for a photograph: the derivative. No parallel endpoint, no second storage path.
 *
 * `requestEditorialUploadAction` and `completeEditorialUploadAction` mirror the document pair
 * deliberately, including `viaServer`: the in-memory store has no URL a browser can PUT to, so
 * `local` and `test` send the bytes through a server action and nothing else ever does.
 */
export async function requestEditorialUploadAction(raw: unknown): Promise<
  | {
      ok: true;
      intentId: string;
      objectKey: string;
      url: string;
      method: string;
      headers: Record<string, string>;
      viaServer: boolean;
    }
  | { ok: false; error: string }
> {
  const input = scope
    .extend({
      filename: z.string().min(1).max(255),
      mimeType: z.string().min(3).max(200),
      sizeBytes: z.number().int().positive(),
    })
    .strict()
    .parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "portal");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  const storage = getStorage();
  if (storage === null) return { ok: false, error: t("documents.storageUnavailable") };
  try {
    const intent = await createUploadIntent(getDb(), access.ctx, storage, {
      namespace: EDITORIAL_NAMESPACE,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
    return {
      ok: true,
      intentId: intent.intentId,
      objectKey: intent.key,
      url: intent.url,
      method: intent.method,
      headers: { ...intent.headers },
      // Same signal the documents path uses: the in-memory store's URL is not fetchable.
      viaServer: intent.url.startsWith("memory://"),
    };
  } catch (error) {
    const result = toResult(error);
    if (result && !result.ok) return result;
    throw error;
  }
}

export async function completeEditorialUploadAction(
  raw: unknown,
): Promise<
  | { ok: true; storedObjectId: string; filename: string; mimeType: string; isPhoto: boolean }
  | { ok: false; error: string }
> {
  const input = scope
    .extend({ intentId: z.string().min(1), objectKey: z.string().min(1) })
    .strict()
    .parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "portal");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  const storage = getStorage();
  if (storage === null) return { ok: false, error: t("documents.storageUnavailable") };
  try {
    const stored = await finalizeUpload(getDb(), access.ctx, storage, {
      intentId: input.intentId,
      objectKey: input.objectKey,
    });
    const isPhoto = stored.mimeType === "image/jpeg" || stored.mimeType === "image/png";
    if (!isPhoto) {
      return {
        ok: true,
        storedObjectId: stored.storedObjectId,
        filename: stored.originalFilename ?? input.objectKey,
        mimeType: stored.mimeType,
        isPhoto: false,
      };
    }
    /*
     * A photograph never reaches the payload as itself. The derivative is produced here, in the
     * same call, so there is no window in which a draft could reference the original — and if
     * this throws, the caller is told the upload failed rather than being handed the original.
     */
    const photo = await createEditorialPhoto(getDb(), access.ctx, storage, {
      originalStoredObjectId: stored.storedObjectId,
    });
    return {
      ok: true,
      storedObjectId: photo.storedObjectId,
      filename: stored.originalFilename ?? input.objectKey,
      mimeType: photo.mimeType,
      isPhoto: true,
    };
  } catch (error) {
    const result = toResult(error);
    if (result && !result.ok) return result;
    throw error;
  }
}

/* ---------------------------------------------------------------------------------------------
 * The firm's own name
 * ------------------------------------------------------------------------------------------ */

/**
 * Tenant-scoped, and the check lives in the use-case. A project editor who reaches this action
 * directly is refused there, not by the absence of a button.
 */
export async function updateEditorialProfileAction(raw: unknown): Promise<EditorialActionResult> {
  const input = scope
    .extend({
      name: z.string().min(1).max(160),
      engagementLabel: z.string().max(200).nullable(),
      // No upper bound: a revision counts upwards for as long as the firm keeps editing. The
      // `max(1)` that used to be here would have refused the third save (migration 0054).
      expectedRevision: z.number().int().min(0),
    })
    .strict()
    .parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "portal");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };
  try {
    const { revision } = await updateEditorialTenantProfile(getDb(), access.ctx, {
      name: input.name,
      engagementLabel: input.engagementLabel,
      expectedRevision: input.expectedRevision,
    });
    revalidateBoth(input.tenant, input.project);
    return { ok: true, message: t("portal.editorial.profileSaved"), profileRevision: revision };
  } catch (error) {
    const result = toResult(error);
    if (result) return result;
    throw error;
  }
}
