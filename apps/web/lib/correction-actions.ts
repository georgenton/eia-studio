"use server";

import { cancelSurveyCorrection, requestSurveyCorrection } from "@eia/application";
import { DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getTranslator } from "@/lib/locale";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * Asking for a submitted response to be captured again (ADR-038).
 *
 * Thin, like every server action here: validate, resolve the context, call the use-case. Neither
 * the permission nor the rule that a correction applies to the *currently effective* response is
 * decided in this layer.
 */
export type CorrectionActionResult = { ok: true; message: string } | { ok: false; error: string };

const scope = z.object({ tenant: z.string(), project: z.string() });

export async function requestCorrectionAction(raw: unknown): Promise<CorrectionActionResult> {
  const input = scope.extend({ instanceId: z.string(), reason: z.string() }).strict().parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "field");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    await requestSurveyCorrection(getDb(), access.ctx, {
      instanceId: input.instanceId,
      reason: input.reason,
      // Whoever held the original assignment. Reassigning a correction is a coordinator's act on
      // the assignment itself, not a decision buried in this form.
      assigneeMembershipId: null,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}`, "layout");
    return { ok: true, message: t("field.correctionDone") };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: t("actions.checkPayload") };
    throw error;
  }
}

export async function cancelCorrectionAction(raw: unknown): Promise<CorrectionActionResult> {
  const input = scope.extend({ correctionId: z.string() }).strict().parse(raw);

  const t = await getTranslator();
  const access = await resolveSurfaceAccess(input.tenant, input.project, "field");
  if (access.kind !== "ok") return { ok: false, error: t("actions.noSurfaceAccess") };

  try {
    await cancelSurveyCorrection(getDb(), access.ctx, { correctionId: input.correctionId });
    revalidatePath(`/t/${input.tenant}/p/${input.project}`, "layout");
    return { ok: true, message: t("field.correctionCancelled") };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}
