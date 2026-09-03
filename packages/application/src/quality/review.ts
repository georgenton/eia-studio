import { qualitySchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  decideFinding,
  NotFound,
  requireCapability,
  requirePermission,
  reviewSubmissionSchema,
  type FindingDecision,
  type FindingState,
  type RequestContext,
} from "@eia/domain";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { recordAudit } from "../audit/record";

/**
 * Settling a finding.
 *
 * Two properties this has to hold, and they are the same two the Social slice needed for a
 * different object.
 *
 * **The decision is the record, and it is never edited.** Every decision inserts a
 * `specialist_review` row with its justification, its author and the transition it made. A change
 * of mind is another row. The database refuses UPDATE and DELETE on that table, because a
 * dismissal that could be quietly rewritten is worse than no dismissal at all: the study would
 * carry a decision nobody made.
 *
 * **The transition is computed, not accepted.** The client sends a decision and a reason; the
 * domain decides whether that decision is legal from the finding's current state, and what state
 * it produces. A client that could post the resulting state could write a history that never
 * happened, and the state a report later reads would be a fiction.
 *
 * `quality.review` is the permission — the REVIEWER role's whole meaning is deciding
 * (TENANCY.md §2.2). A specialist with `quality.write` runs the check and reads the findings; they
 * do not settle them.
 */
export const decideFindingInputSchema = z
  .object({ findingId: z.uuid() })
  .extend(reviewSubmissionSchema.shape)
  .strict();
export type DecideFindingInput = z.infer<typeof decideFindingInputSchema>;

export interface FindingDecisionResult {
  readonly reviewId: string;
  readonly decision: FindingDecision;
  readonly fromState: FindingState;
  readonly toState: FindingState;
}

export async function decideQualityFinding(
  db: Database,
  ctx: RequestContext,
  input: DecideFindingInput,
): Promise<FindingDecisionResult> {
  requireCapability(ctx, "quality.document_gate");
  requirePermission(ctx, "quality.review");
  const parsed = decideFindingInputSchema.parse(input);
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    // `for update`: two reviewers deciding the same finding at once must serialise, or the second
    // decision would be recorded as a transition from a state that no longer applied.
    const found = await tx.execute(sql`
      select id, state::text as state, finding_code
        from app.quality_finding
       where tenant_id = ${ctx.tenantId} and project_id = ${projectId} and id = ${parsed.findingId}
       for update
    `);
    const finding = found.rows[0] as
      { id: string; state: FindingState; finding_code: string } | undefined;
    if (!finding) throw new NotFound("finding");

    const transition = decideFinding(finding.state, {
      decision: parsed.decision,
      justification: parsed.justification,
    });

    const reviewId = randomUUID();
    await tx.insert(qualitySchema.specialistReview).values({
      id: reviewId,
      tenantId: ctx.tenantId,
      projectId,
      findingId: finding.id,
      decision: transition.decision,
      fromState: transition.fromState,
      toState: transition.toState,
      justification: transition.justification,
      reviewerUserId: ctx.userId,
    });

    await tx.execute(sql`
      update app.quality_finding
         set state = ${transition.toState}::app.quality_finding_state,
             interdisciplinary_review_required =
               ${transition.interdisciplinaryRequired} or interdisciplinary_review_required,
             updated_at = now()
       where tenant_id = ${ctx.tenantId} and id = ${finding.id}
    `);

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "quality.finding.decided",
        objectKind: "quality_finding",
        objectId: finding.id,
        details: {
          // The finding's code and the transition, never the justification: it is the specialist's
          // reasoning about a study, and the audit log is not where it belongs (it is on the row).
          findingCode: finding.finding_code,
          decision: transition.decision,
          fromState: transition.fromState,
          toState: transition.toState,
        },
      },
    );

    return {
      reviewId,
      decision: transition.decision,
      fromState: transition.fromState,
      toState: transition.toState,
    };
  });
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}

/** Re-exported so the web layer and the tests share one shape. */
export type { DbTx };
