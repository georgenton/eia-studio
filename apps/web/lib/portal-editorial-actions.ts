"use server";

import {
  EditorialRevisionConflict,
  publishEditorial,
  saveEditorialDraft,
  withdrawEditorial,
} from "@eia/application";
import { DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
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

export type EditorialActionResult =
  { ok: true; message: string; revision?: number } | { ok: false; error: string };

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
