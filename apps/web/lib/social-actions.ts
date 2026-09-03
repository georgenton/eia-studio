"use server";

import { startClassificationRun, submitHumanReview } from "@eia/application";
import { DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * Social Intelligence server actions.
 *
 * Like the FieldFlow ones, each rebuilds the `RequestContext` from the session and the URL and
 * re-runs its capability and permission checks. Two things are specifically not taken from the
 * client:
 *
 * - **the model and the classifier**, which come from server configuration. A browser that could
 *   name the model could name a different one for one run and make the run record a fiction;
 * - **the review decision**, which the use-case derives from the two label sets. A client that
 *   could send `ACCEPTED` could record a correction as an agreement, and that number is exactly
 *   what an evaluation would later rest on.
 */
export type SocialActionResult =
  { readonly ok: true; readonly message?: string } | { readonly ok: false; readonly error: string };

const scopeSchema = z.object({
  tenant: z.string().min(1).max(80),
  project: z.string().min(1).max(80),
});

async function resolveSocialContext(raw: unknown) {
  const scope = scopeSchema.parse(raw);
  return {
    scope,
    access: await resolveSurfaceAccess(scope.tenant, scope.project, "social"),
  } as const;
}

function failureFor(error: unknown): SocialActionResult {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  if (error instanceof z.ZodError) {
    return { ok: false, error: "Revisa los datos enviados." };
  }
  throw error;
}

export async function startClassificationRunAction(raw: unknown): Promise<SocialActionResult> {
  const input = z
    .object({
      tenant: z.string(),
      project: z.string(),
      taxonomyVersionId: z.string().uuid(),
      surveyVersionId: z.string().uuid(),
      questionId: z.string().uuid(),
    })
    .strict()
    .parse(raw);

  const { access } = await resolveSocialContext(input);
  if (access.kind !== "ok") {
    return { ok: false, error: "No tienes acceso a esta superficie." };
  }

  const env = getEnv();
  try {
    const started = await startClassificationRun(
      getDb(),
      access.ctx,
      {
        taxonomyVersionId: input.taxonomyVersionId,
        surveyVersionId: input.surveyVersionId,
        questionId: input.questionId,
      },
      {
        // Configuration, never the client. Recorded on the run so a proposal can be traced to the
        // exact model and adapter that produced it.
        model: env.social.SOCIAL_CLASSIFIER_MODEL,
        classifierKind: env.social.SOCIAL_CLASSIFIER,
      },
    );
    revalidatePath(`/t/${input.tenant}/p/${input.project}/social`, "layout");
    return {
      ok: true,
      message: `Ejecución creada: ${started.queued} respuestas en cola${
        started.skipped > 0 ? `, ${started.skipped} omitidas` : ""
      }.`,
    };
  } catch (error) {
    return failureFor(error);
  }
}

export async function submitReviewAction(raw: unknown): Promise<SocialActionResult> {
  const input = z
    .object({
      tenant: z.string(),
      project: z.string(),
      classificationId: z.string().uuid(),
      categoryCodes: z.array(z.string().min(2).max(64)).min(1).max(8),
      reviewStartedAt: z.string().datetime().nullable(),
    })
    .strict()
    .parse(raw);

  const { access } = await resolveSocialContext(input);
  if (access.kind !== "ok") {
    return { ok: false, error: "No tienes acceso a esta superficie." };
  }

  try {
    const result = await submitHumanReview(getDb(), access.ctx, {
      classificationId: input.classificationId,
      categoryCodes: input.categoryCodes,
      reviewStartedAt: input.reviewStartedAt,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}/social`, "layout");
    return {
      ok: true,
      message:
        result.decision === "ACCEPTED"
          ? "Propuesta aceptada y registrada como codificación validada."
          : `Codificación corregida: ${result.added.length} añadida(s), ${result.removed.length} retirada(s).`,
    };
  } catch (error) {
    return failureFor(error);
  }
}
