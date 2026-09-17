"use server";

import {
  createUploadIntent,
  finalizeUpload,
  queueDocumentExtraction,
  uploadDocumentVersion,
  type MemoryStorage,
} from "@eia/application";
import { DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getTranslator } from "@/lib/locale";
import { getStorage } from "@/lib/storage";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * Uploading a delivered file, in the three steps the architecture requires (ADR-031).
 *
 * The bytes do not come through the server: the browser asks for an **intent**, PUTs the file
 * straight to the provider, and then asks the server to **finalize** — which verifies against the
 * provider rather than against the browser's word. A 90 MB study streamed through a request only
 * to be streamed out again is the shape this avoids.
 *
 * These actions are thin. Every decision — the permission, the format, the key, the size ceiling,
 * the magic bytes, the hash — belongs to the use-cases in `@eia/application`, which the worker and
 * the mobile app will call with the same guarantees. This file resolves a context and translates
 * an error.
 */

const scope = z.object({ tenant: z.string(), project: z.string() });

export type UploadIntentResult =
  | {
      ok: true;
      intentId: string;
      url: string;
      method: string;
      headers: Record<string, string>;
      objectKey: string;
      expiresAt: string;
      /**
       * True when this deployment's store is the in-memory one, whose "presigned" URL no browser
       * can PUT to. The client then sends the bytes through `putLocalBytesAction` instead. Only
       * `local` and `test` ever see this: `resolveStorageAvailability` refuses the memory store
       * anywhere a process exiting would lose a citation.
       */
      viaServer: boolean;
    }
  | { ok: false; error: string };

export type UploadResult =
  | { ok: true; message: string; documentCode: string; versionLabel: string }
  | { ok: false; error: string };

export async function requestDocumentUploadAction(raw: unknown): Promise<UploadIntentResult> {
  const input = scope
    .extend({
      filename: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
    })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "documents");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  const storage = getStorage();
  if (!storage) return { ok: false, error: t("documents.storageUnavailable") };

  try {
    const intent = await createUploadIntent(getDb(), access.ctx, storage, {
      namespace: "documents",
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
    return {
      ok: true,
      intentId: intent.intentId,
      url: intent.url,
      method: intent.method,
      headers: { ...intent.headers },
      objectKey: intent.key,
      expiresAt: intent.expiresAt.toISOString(),
      viaServer: intent.url.startsWith("memory://"),
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * The in-memory store's stand-in for the browser's PUT.
 *
 * It exists because that store's URL is a token only this process understands, so there is nothing
 * for a browser to upload to. It refuses outright unless this deployment actually resolved to the
 * memory provider, so it cannot become a second, unverified way of putting bytes in a bucket.
 *
 * Nothing here trusts the bytes: `finalizeUpload` still reads them back out of the store, checks
 * the size against the ceiling the intent signed for, checks the magic bytes against the declared
 * format, and computes the SHA-256 itself.
 */
export async function putLocalBytesAction(raw: unknown): Promise<{ ok: boolean; error?: string }> {
  const input = scope
    .extend({ objectKey: z.string(), contentType: z.string(), base64: z.string() })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "documents");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  const env = getEnv();
  const storage = getStorage();
  if (!storage || env.storage.state !== "AVAILABLE" || env.storage.provider !== "memory") {
    return { ok: false, error: t("documents.storageUnavailable") };
  }
  // The key was minted by `createUploadIntent` for this tenant and project; a caller who invented
  // one still has to present a matching intent at finalize, which is where it would be refused.
  (storage as MemoryStorage).put(
    input.objectKey,
    new Uint8Array(Buffer.from(input.base64, "base64")),
    input.contentType,
  );
  return { ok: true };
}

/**
 * Ask for a version to be read again.
 *
 * Only reachable for a version that is `UPLOADED`, `FAILED` or `REQUIRES_OCR` — the use-case
 * refuses a `READY` one, because its chunks are immutable and a second set over the same bytes
 * would make every citation of the first ambiguous (ADR-033).
 */
export async function requeueExtractionAction(
  raw: unknown,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const input = scope.extend({ versionId: z.string() }).strict().parse(raw);
  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "documents");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    const result = await queueDocumentExtraction(getDb(), access.ctx, input.versionId);
    revalidatePath(`/t/${input.tenant}/p/${input.project}/documents`, "page");
    return {
      ok: true,
      message: result.queued ? t("documents.requeued") : t("documents.alreadyQueued"),
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function completeDocumentUploadAction(raw: unknown): Promise<UploadResult> {
  const input = scope
    .extend({
      intentId: z.string(),
      objectKey: z.string(),
      documentId: z.string().nullable(),
      code: z.string().nullable(),
      title: z.string().nullable(),
      kind: z.string().nullable(),
      privacyClassification: z.string(),
      sourceDate: z.string().nullable(),
      sourceNote: z.string(),
    })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "documents");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  const storage = getStorage();
  if (!storage) return { ok: false, error: t("documents.storageUnavailable") };

  try {
    const stored = await finalizeUpload(getDb(), access.ctx, storage, {
      intentId: input.intentId,
      objectKey: input.objectKey,
    });
    const version = await uploadDocumentVersion(getDb(), access.ctx, {
      documentId: input.documentId,
      code: input.code,
      title: input.title,
      kind: input.kind,
      storedObjectId: stored.storedObjectId,
      privacyClassification: input.privacyClassification,
      sourceDate: input.sourceDate,
      sourceNote: input.sourceNote,
    });
    /*
     * `UPLOADED → QUEUED`, as the last step and in its own call (ADR-033).
     *
     * Separate, because the two states mean different things: `UPLOADED` is *the file is stored and
     * nobody has asked for it to be read*, which is exactly where a version sits if this fails. A
     * person can ask again from the surface; silently collapsing the states would leave a document
     * that looks queued and is not.
     */
    if (version.outcome === "stored" && version.versionId !== null) {
      await queueDocumentExtraction(getDb(), access.ctx, version.versionId).catch(() => undefined);
    }
    revalidatePath(`/t/${input.tenant}/p/${input.project}/documents`, "page");
    return {
      ok: true,
      // Re-uploading the same bytes is answered, not duplicated: the caller is told which version
      // already holds this file rather than being given a second one that differs only in number.
      message:
        version.outcome === "same_content"
          ? t("documents.uploadSameContent", { version: version.versionLabel })
          : t("documents.uploadStored", { version: version.versionLabel }),
      documentCode: version.documentCode,
      versionLabel: version.versionLabel,
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: t("actions.checkPayload") };
    throw error;
  }
}
