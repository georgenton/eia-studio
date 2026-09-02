"use server";

import {
  completeVisit as completeVisitUseCase,
  saveSurveyDraft,
  startVisit as startVisitUseCase,
  submitSurveyInstance,
} from "@eia/application";
import { DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * FieldFlow server actions.
 *
 * Every one of them rebuilds the `RequestContext` from the session and the URL and re-runs the
 * capability and permission checks. Nothing a client sends is trusted: not the technician id, not
 * the project, not the assignment's ownership, not the survey version. The form does not even
 * carry those — the action re-resolves them — because a field the browser can edit is a field an
 * attacker can edit.
 *
 * They return a discriminated result rather than throwing across the boundary, so the form can
 * render an error beside the control that caused it instead of replacing the page with a stack
 * trace mid-visit.
 */
export type FieldActionResult =
  | { readonly ok: true; readonly message?: string; readonly redirectTo?: string }
  | { readonly ok: false; readonly error: string; readonly fieldErrors?: Record<string, string> };

/**
 * Deliberately not `.strict()`: this reads only the scope out of a payload that also carries the
 * action's own fields, each of which its own schema validates strictly. A strict schema here
 * rejected every mutation for "unrecognized keys".
 */
const scopeSchema = z.object({
  tenant: z.string().min(1).max(80),
  project: z.string().min(1).max(80),
});

/**
 * Resolve the caller for a FieldFlow mutation. The slugs come from the form because the action has
 * no URL of its own; they are looked up inside the caller's memberships, so a forged slug is
 * indistinguishable from one that does not exist.
 */
async function resolveFieldContext(raw: unknown) {
  const scope = scopeSchema.parse(raw);
  const access = await resolveSurfaceAccess(scope.tenant, scope.project, "field");
  if (access.kind !== "ok") return { access, scope } as const;
  return { access, scope } as const;
}

function failureFor(error: unknown): FieldActionResult {
  if (error instanceof DomainError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "form";
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, error: "Revisa los datos del formulario.", fieldErrors };
  }
  // Anything else is a bug, not a user error; the reference id is what a log search needs.
  throw error;
}

export async function startVisitAction(raw: unknown): Promise<FieldActionResult> {
  const input = z
    .object({
      tenant: z.string(),
      project: z.string(),
      assignmentId: z.string().uuid(),
      locationOutcome: z.enum(["captured", "denied", "unavailable", "not_attempted"]),
      latitude: z.number().min(-90).max(90).nullable(),
      longitude: z.number().min(-180).max(180).nullable(),
      accuracyM: z.number().positive().nullable(),
      capturedAt: z.string().datetime().nullable(),
    })
    .strict()
    .parse(raw);

  const { access } = await resolveFieldContext(input);
  if (access.kind !== "ok") {
    return { ok: false, error: "No tienes acceso a esta asignación." };
  }

  try {
    const hasPoint =
      input.locationOutcome === "captured" &&
      input.latitude !== null &&
      input.longitude !== null &&
      input.capturedAt !== null;

    await startVisitUseCase(getDb(), access.ctx, {
      assignmentId: input.assignmentId,
      locationOutcome: input.locationOutcome,
      location: hasPoint
        ? {
            latitude: input.latitude!,
            longitude: input.longitude!,
            accuracyM: input.accuracyM,
            capturedAt: new Date(input.capturedAt!),
          }
        : null,
    });
  } catch (error) {
    return failureFor(error);
  }

  revalidatePath(`/t/${input.tenant}/p/${input.project}/field`, "layout");
  return { ok: true };
}

const answerPayloadSchema = z.record(
  z.string().min(1).max(40),
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), value: z.string().max(4000) }).strict(),
    z.object({ kind: z.literal("number"), value: z.number().finite() }).strict(),
    z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
    z.object({ kind: z.literal("date"), value: z.string() }).strict(),
    z.object({ kind: z.literal("option"), optionCode: z.string().max(40) }).strict(),
    z.object({ kind: z.literal("options"), optionCodes: z.array(z.string().max(40)) }).strict(),
    z.object({ kind: z.literal("blank") }).strict(),
  ]),
);

const answerActionSchema = z
  .object({
    tenant: z.string(),
    project: z.string(),
    assignmentId: z.string().uuid(),
    visitId: z.string().uuid().nullable(),
    answers: answerPayloadSchema,
  })
  .strict();

export async function saveDraftAction(raw: unknown): Promise<FieldActionResult> {
  const input = answerActionSchema.parse(raw);
  const { access } = await resolveFieldContext(input);
  if (access.kind !== "ok") {
    return { ok: false, error: "No tienes acceso a esta asignación." };
  }

  try {
    await saveSurveyDraft(getDb(), access.ctx, {
      assignmentId: input.assignmentId,
      visitId: input.visitId,
      answers: input.answers,
    });
  } catch (error) {
    return failureFor(error);
  }

  revalidatePath(
    `/t/${input.tenant}/p/${input.project}/field/assignments/${input.assignmentId}`,
    "page",
  );
  return { ok: true, message: "Borrador guardado." };
}

export async function submitSurveyAction(raw: unknown): Promise<FieldActionResult> {
  const input = answerActionSchema.parse(raw);
  const { access } = await resolveFieldContext(input);
  if (access.kind !== "ok") {
    return { ok: false, error: "No tienes acceso a esta asignación." };
  }

  try {
    const result = await submitSurveyInstance(getDb(), access.ctx, {
      assignmentId: input.assignmentId,
      visitId: input.visitId,
      answers: input.answers,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}/field`, "layout");
    return {
      ok: true,
      // A retried submit is not an error: the caller's intent is already true.
      message: result.alreadySubmitted ? "Esta ficha ya estaba enviada." : "Ficha enviada.",
    };
  } catch (error) {
    return failureFor(error);
  }
}

export async function completeVisitAction(raw: unknown): Promise<FieldActionResult> {
  const input = z
    .object({
      tenant: z.string(),
      project: z.string(),
      visitId: z.string().uuid(),
    })
    .strict()
    .parse(raw);

  const { access } = await resolveFieldContext(input);
  if (access.kind !== "ok") {
    return { ok: false, error: "No tienes acceso a esta visita." };
  }

  try {
    await completeVisitUseCase(getDb(), access.ctx, input.visitId);
  } catch (error) {
    return failureFor(error);
  }
  revalidatePath(`/t/${input.tenant}/p/${input.project}/field`, "layout");
  return { ok: true };
}
