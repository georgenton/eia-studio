"use server";

import {
  activateTemplateVersion,
  createReportTemplate,
  generateDocumentFromTemplate,
  revalidateTemplateVersion,
  uploadTemplateVersion,
  type MemoryStorage,
} from "@eia/application";
import { DomainError, TEMPLATE_KINDS, TEMPLATE_LOCALES } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getTranslator } from "@/lib/locale";
import { getStorage } from "@/lib/storage";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * Registering a template, uploading a version of it, activating it, and producing a document
 * (ADR-036).
 *
 * Thin, as every action here is. The format allowlist, the archive checks, the closed placeholder
 * vocabulary, the activation rules and the refusal to invent a missing figure all belong to
 * `@eia/application` and `@eia/domain`. This file resolves a context, carries the localized words
 * for *no value*, and translates an error.
 */

const scope = z.object({ tenant: z.string(), project: z.string() });

export type SimpleResult = { ok: true; message: string } | { ok: false; error: string };

export async function createTemplateAction(raw: unknown): Promise<SimpleResult> {
  const input = scope
    .extend({
      code: z.string(),
      name: z.string(),
      kind: z.enum(TEMPLATE_KINDS),
      purpose: z.string(),
    })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "reports");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    const created = await createReportTemplate(getDb(), access.ctx, {
      code: input.code,
      name: input.name,
      kind: input.kind,
      purpose: input.purpose,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}/reports/templates`);
    return { ok: true, message: t("templates.created", { code: created.code }) };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}

export type TemplateUploadIntentResult =
  | {
      ok: true;
      intentId: string;
      url: string;
      method: string;
      headers: Record<string, string>;
      objectKey: string;
      viaServer: boolean;
    }
  | { ok: false; error: string };

/**
 * The upload's first step, in the `templates` namespace.
 *
 * It reuses `createUploadIntent` rather than a second upload path, so a template is bounded by the
 * same format allowlist, the same size ceiling and the same server-minted key every other file is.
 */
export async function requestTemplateUploadAction(
  raw: unknown,
): Promise<TemplateUploadIntentResult> {
  const input = scope
    .extend({ filename: z.string(), mimeType: z.string(), sizeBytes: z.number() })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "reports");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  const storage = getStorage();
  if (!storage) return { ok: false, error: t("templates.storageUnavailable") };

  try {
    const { createUploadIntent } = await import("@eia/application");
    const intent = await createUploadIntent(getDb(), access.ctx, storage, {
      namespace: "templates",
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
      viaServer: intent.url.startsWith("memory://"),
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}

/** The in-memory store's stand-in for the browser's PUT, as the document upload has. */
export async function putTemplateBytesAction(
  raw: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const input = scope
    .extend({ objectKey: z.string(), contentType: z.string(), base64: z.string() })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "reports");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  const env = getEnv();
  const storage = getStorage();
  if (!storage || env.storage.state !== "AVAILABLE" || env.storage.provider !== "memory") {
    return { ok: false, error: t("templates.storageUnavailable") };
  }
  await (storage as MemoryStorage).put(
    input.objectKey,
    new Uint8Array(Buffer.from(input.base64, "base64")),
    input.contentType,
  );
  return { ok: true };
}

export type CompleteUploadResult =
  | { ok: true; message: string; versionLabel: string; unknown: ReadonlyArray<string> }
  | { ok: false; error: string };

export async function completeTemplateUploadAction(raw: unknown): Promise<CompleteUploadResult> {
  const input = scope
    .extend({
      templateId: z.uuid(),
      locale: z.enum(TEMPLATE_LOCALES),
      intentId: z.uuid(),
      objectKey: z.string(),
    })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "reports");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  const storage = getStorage();
  if (!storage) return { ok: false, error: t("templates.storageUnavailable") };

  try {
    const { finalizeUpload } = await import("@eia/application");
    // Verified against the provider, never against the browser's word (ADR-031).
    const stored = await finalizeUpload(getDb(), access.ctx, storage, {
      intentId: input.intentId,
      objectKey: input.objectKey,
    });
    const version = await uploadTemplateVersion(getDb(), access.ctx, storage, {
      templateId: input.templateId,
      locale: input.locale,
      storedObjectId: stored.storedObjectId,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}/reports/templates`);
    return {
      ok: true,
      message: version.answered
        ? t("templates.uploadAnswered", { version: version.versionLabel })
        : t("templates.uploaded", { version: version.versionLabel }),
      versionLabel: version.versionLabel,
      unknown: version.manifest?.unknown ?? [],
    };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function activateTemplateVersionAction(raw: unknown): Promise<SimpleResult> {
  const input = scope.extend({ versionId: z.uuid() }).strict().parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "reports");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    await activateTemplateVersion(getDb(), access.ctx, input.versionId);
    revalidatePath(`/t/${input.tenant}/p/${input.project}/reports/templates`);
    return { ok: true, message: t("templates.activated") };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function revalidateTemplateVersionAction(raw: unknown): Promise<SimpleResult> {
  const input = scope.extend({ versionId: z.uuid() }).strict().parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "reports");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  const storage = getStorage();
  if (!storage) return { ok: false, error: t("templates.storageUnavailable") };

  try {
    const outcome = await revalidateTemplateVersion(getDb(), access.ctx, storage, input.versionId);
    revalidatePath(`/t/${input.tenant}/p/${input.project}/reports/templates`);
    return outcome.validationError
      ? { ok: false, error: t("templates.validationError", { error: outcome.validationError }) }
      : { ok: true, message: t("templates.revalidated") };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function generateDocumentAction(raw: unknown): Promise<SimpleResult> {
  const input = scope.extend({ versionId: z.uuid() }).strict().parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "reports");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  const storage = getStorage();
  if (!storage) return { ok: false, error: t("templates.storageUnavailable") };

  try {
    await generateDocumentFromTemplate(getDb(), access.ctx, storage, {
      templateVersionId: input.versionId,
      // The words for an absent optional value come from the catalogue, never from the renderer:
      // the domain decides there is no value, the reader's language decides how that reads.
      notAvailableText: t("templates.notAvailable"),
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}/reports/templates`);
    return { ok: true, message: t("templates.generated") };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}
