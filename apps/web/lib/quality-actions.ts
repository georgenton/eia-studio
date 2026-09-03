"use server";

import { decideQualityFinding, runQualityCheck } from "@eia/application";
import { DomainError } from "@eia/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { resolveSurfaceAccess } from "@/lib/surface-access";

/**
 * Quality Gate server actions.
 *
 * Like the FieldFlow and Social ones, each rebuilds the `RequestContext` from the session and the
 * URL and re-runs its own capability and permission checks. Running the rule set needs
 * `quality.write`; settling a finding needs `quality.review` — a specialist checks, a reviewer
 * decides (TENANCY.md §2.2).
 *
 * The resulting **state is never taken from the client**. The client sends a decision and a
 * reason; the domain works out whether that decision is legal from the finding's current state and
 * what state it produces. A client that could post the outcome could write a history that never
 * happened, and a report reading that state later would be reading a fiction.
 */
export type QualityActionResult =
  { readonly ok: true; readonly message?: string } | { readonly ok: false; readonly error: string };

const scopeSchema = z.object({
  tenant: z.string().min(1).max(80),
  project: z.string().min(1).max(80),
});

function failureFor(error: unknown): QualityActionResult {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  if (error instanceof z.ZodError) return { ok: false, error: "Revisa los datos enviados." };
  throw error;
}

export async function runQualityCheckAction(raw: unknown): Promise<QualityActionResult> {
  const input = scopeSchema.strict().parse(raw);
  const access = await resolveSurfaceAccess(input.tenant, input.project, "quality");
  if (access.kind !== "ok") return { ok: false, error: "No tienes acceso a esta superficie." };

  try {
    const result = await runQualityCheck(getDb(), access.ctx);
    revalidatePath(`/t/${input.tenant}/p/${input.project}/quality`, "layout");
    const parts = [`${result.created} hallazgo(s) nuevo(s)`, `${result.updated} actualizado(s)`];
    if (result.reopened > 0) parts.push(`${result.reopened} reabierto(s)`);
    // Named, not hidden: a rule that could not read its inputs is something a specialist should
    // know about, because it means that comparison was not made at all.
    if (result.skipped.length > 0) {
      parts.push(`${result.skipped.length} regla(s) sin datos suficientes`);
    }
    return { ok: true, message: `Revisión ejecutada: ${parts.join(" · ")}.` };
  } catch (error) {
    return failureFor(error);
  }
}

export async function decideFindingAction(raw: unknown): Promise<QualityActionResult> {
  const input = z
    .object({
      tenant: z.string(),
      project: z.string(),
      findingId: z.string().uuid(),
      decision: z.string().min(1).max(40),
      justification: z.string().min(1).max(2000),
    })
    .strict()
    .parse(raw);

  const access = await resolveSurfaceAccess(input.tenant, input.project, "quality");
  if (access.kind !== "ok") return { ok: false, error: "No tienes acceso a esta superficie." };

  try {
    const result = await decideQualityFinding(getDb(), access.ctx, {
      findingId: input.findingId,
      // Parsed by the domain's own enum: an unknown decision is rejected there, not coerced here.
      decision: input.decision as never,
      justification: input.justification,
    });
    revalidatePath(`/t/${input.tenant}/p/${input.project}/quality`, "layout");
    return { ok: true, message: `Decisión registrada: ${result.fromState} → ${result.toState}.` };
  } catch (error) {
    return failureFor(error);
  }
}
