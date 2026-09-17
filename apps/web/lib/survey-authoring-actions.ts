"use server";

import {
  createSurveyDraft,
  createSurveyTemplate,
  publishSurveyVersion,
  saveSurveyDefinition,
} from "@eia/application";
import { authoredDefinitionSchema, DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getTranslator } from "@/lib/locale";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * Writing a questionnaire, from the browser (ADR-037).
 *
 * Thin, like every server action in this application: validate the payload, resolve the context,
 * call the use-case. Neither the permission nor the draft/published distinction is decided here —
 * both are the use-case's, and the database's underneath it.
 */
export type AuthoringActionResult =
  { ok: true; message: string; versionId?: string } | { ok: false; error: string };

const scope = z.object({ tenant: z.string(), project: z.string() });

export async function createSurveyTemplateAction(raw: unknown): Promise<AuthoringActionResult> {
  const input = scope
    .extend({
      key: z.string(),
      name: z.string(),
      description: z.string().nullable(),
    })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "intake");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    const created = await createSurveyTemplate(getDb(), access.ctx, {
      key: input.key,
      name: input.name,
      description: input.description,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}`, "layout");
    return { ok: true, message: t("authoring.created"), versionId: created.versionId };
  } catch (error) {
    return failure(error, t("actions.checkPayload"));
  }
}

export async function createSurveyDraftAction(raw: unknown): Promise<AuthoringActionResult> {
  const input = scope
    .extend({ templateId: z.string(), copyFromVersionId: z.string().nullable() })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "intake");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    const created = await createSurveyDraft(getDb(), access.ctx, {
      templateId: input.templateId,
      copyFromVersionId: input.copyFromVersionId,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}`, "layout");
    return {
      ok: true,
      message: t("authoring.draftOpened", { version: created.versionLabel }),
      versionId: created.versionId,
    };
  } catch (error) {
    return failure(error, t("actions.checkPayload"));
  }
}

export async function saveSurveyDefinitionAction(raw: unknown): Promise<AuthoringActionResult> {
  /*
   * The domain's own schema, reused rather than restated. A second description of what a
   * questionnaire is would be a second thing to keep in step with the first, and the boundary
   * this action guards is the *context*, not the shape.
   */
  const input = scope
    .extend({ versionId: z.string(), definition: authoredDefinitionSchema })
    .strict()
    .parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "intake");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    await saveSurveyDefinition(getDb(), access.ctx, {
      versionId: input.versionId,
      definition: input.definition,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}`, "layout");
    return { ok: true, message: t("intake.saved") };
  } catch (error) {
    return failure(error, t("actions.checkPayload"));
  }
}

export async function publishSurveyVersionAction(raw: unknown): Promise<AuthoringActionResult> {
  const input = scope.extend({ versionId: z.string() }).strict().parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "intake");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    const published = await publishSurveyVersion(getDb(), access.ctx, {
      versionId: input.versionId,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}`, "layout");
    return { ok: true, message: t("authoring.published", { version: published.versionLabel }) };
  } catch (error) {
    return failure(error, t("actions.checkPayload"));
  }
}

function failure(error: unknown, fallback: string): AuthoringActionResult {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  if (error instanceof z.ZodError) return { ok: false, error: fallback };
  throw error;
}
