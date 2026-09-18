import { randomUUID } from "node:crypto";

import { appSchema, fieldSchema, type Database, type DbTx } from "@eia/db";
import {
  assertCorrectionRequestable,
  correctionReasonSchema,
  InvalidInput,
  NotFound,
  requireCapability,
  requirePermission,
  type CorrectionState,
  type RequestContext,
} from "@eia/domain";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../audit/record";
import { withFieldContext } from "./context";

/**
 * Requesting, cancelling and reading a correction (ADR-038).
 *
 * The third act — **applying** one — is not here: it happens where a response is submitted, in
 * `submitSurveyInstance`, in the same transaction. A correction that were applied by a separate
 * call could be submitted and not applied, and the window between the two is exactly the window in
 * which analytics would show a response nobody stands behind.
 */

/**
 * **The one join.** Which response does this study currently mean?
 *
 * `app.effective_survey_instance` is the rule, in the database, once (migration 0051). Every
 * analytic joins it through this helper rather than writing its own predicate, because
 * `where superseded = false` written in six places is six chances to disagree — and the
 * disagreement would be silent: two screens showing different counts of the same households.
 *
 * `packages/testing/test/rls/survey-corrections.integration.test.ts` greps the application source
 * and fails if a second implementation appears.
 */
export const EFFECTIVE_INSTANCE_JOIN = (alias: string) => {
  const a = sql.raw(alias);
  return sql`join app.effective_survey_instance eff
    on eff.tenant_id = ${a}.tenant_id and eff.effective_instance_id = ${a}.id`;
};

/** The same rule as an EXISTS, for a query that already has the instance and only needs the test. */
export const IS_EFFECTIVE_INSTANCE = (alias: string) => {
  const a = sql.raw(alias);
  return sql`exists (
    select 1 from app.effective_survey_instance eff_test
     where eff_test.tenant_id = ${a}.tenant_id
       and eff_test.effective_instance_id = ${a}.id
  )`;
};

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new InvalidInput("this action needs a project context");
  return ctx.projectId;
}

/* ---------------------------------------------------------------------------------------------
 * requesting
 * ------------------------------------------------------------------------------------------ */

export const requestCorrectionInputSchema = z
  .object({
    instanceId: z.uuid(),
    reason: correctionReasonSchema,
    /**
     * Who captures the correction. Omitted, it is whoever held the original assignment — the
     * ordinary case, and the one that needs no decision from the person requesting.
     */
    assigneeMembershipId: z.uuid().nullable(),
  })
  .strict();
export type RequestCorrectionInput = z.infer<typeof requestCorrectionInputSchema>;

export interface RequestedCorrection {
  readonly correctionId: string;
  readonly correctionAssignmentId: string;
  readonly originalInstanceId: string;
}

/**
 * Ask for a submitted response to be captured again.
 *
 * Creates the correction **and** the assignment that will carry it, in one transaction: a request
 * with no work item is a note nobody receives, and an assignment with no request is a revisit
 * nobody asked for.
 */
export async function requestSurveyCorrection(
  db: Database,
  ctx: RequestContext,
  raw: RequestCorrectionInput,
): Promise<RequestedCorrection> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.corrections.request");
  const projectId = requireProject(ctx);
  const input = requestCorrectionInputSchema.parse(raw);

  return withFieldContext(db, ctx, async (tx) => {
    const target = await readCorrectableInstance(tx, ctx, input.instanceId);

    assertCorrectionRequestable({
      instanceStatus: target.status,
      isEffective: target.isEffective,
      hasOpenCorrection: target.hasOpenCorrection,
    });

    const assignee = input.assigneeMembershipId
      ? await readAssignee(tx, ctx, projectId, input.assigneeMembershipId)
      : { membershipId: target.assigneeMembershipId, userId: target.assigneeUserId };

    /*
     * The correction's own provenance. It is **not** a modification of the original — it is a new
     * live observation, made in order to supersede the previous one, and the method text says so in
     * words. Both records survive; the relation between them is the `survey_correction` row.
     */
    const provenanceId = randomUUID();
    await tx.insert(appSchema.provenanceRecord).values({
      id: provenanceId,
      tenantId: ctx.tenantId,
      projectId,
      regime: target.regime === "DEMO_SIMULATION" ? "DEMO_SIMULATION" : "LIVE_OPERATIONAL",
      origin: "FIELD_CAPTURE",
      transformations: ["ORIGINAL"],
      granularity: "INDIVIDUAL",
      title: "Revisita de corrección",
      note:
        "Captura nueva, solicitada para sustituir una respuesta ya enviada. No modifica la " +
        "respuesta original, que se conserva íntegra.",
      method:
        "Solicitud de corrección registrada en el flujo de campo; la respuesta corregida se " +
        "captura de nuevo contra la misma versión del cuestionario.",
      capturedAt: new Date(),
      validationState: "PENDING",
    });

    const correctionAssignmentId = randomUUID();
    await tx.insert(fieldSchema.fieldAssignment).values({
      id: correctionAssignmentId,
      tenantId: ctx.tenantId,
      projectId,
      // Same campaign and same parcel: tabulation is scoped by campaign, and a correction that
      // left the campaign would leave the count it is meant to correct.
      campaignId: target.campaignId,
      parcelId: target.parcelId,
      assigneeMembershipId: assignee.membershipId,
      assigneeUserId: assignee.userId,
      status: "PENDING",
      correctsAssignmentId: target.assignmentId,
      provenanceId,
    });

    const correctionId = randomUUID();
    await tx.insert(fieldSchema.surveyCorrection).values({
      id: correctionId,
      tenantId: ctx.tenantId,
      projectId,
      originalInstanceId: target.id,
      correctionAssignmentId,
      state: "REQUESTED",
      reason: input.reason,
      requestedByUserId: ctx.userId,
    });

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.survey.correction_requested",
        objectKind: "survey_correction",
        objectId: correctionId,
        details: {
          // Identifiers and a count. Never the reason, and never an answer: a reason can quote one.
          originalInstanceId: target.id,
          correctionAssignmentId,
          reassigned: assignee.userId !== target.assigneeUserId,
        },
      },
    );

    return { correctionId, correctionAssignmentId, originalInstanceId: target.id };
  });
}

/* ---------------------------------------------------------------------------------------------
 * cancelling
 * ------------------------------------------------------------------------------------------ */

export const cancelCorrectionInputSchema = z.object({ correctionId: z.uuid() }).strict();
export type CancelCorrectionInput = z.infer<typeof cancelCorrectionInputSchema>;

/**
 * Withdraw a correction nobody captured.
 *
 * The original was effective throughout and stays effective — cancelling changes no count, which
 * is the property that makes requesting one safe. The correction assignment is `CANCELLED` rather
 * than deleted, so a technician who already downloaded it is told, and the request itself remains
 * in the record.
 */
export async function cancelSurveyCorrection(
  db: Database,
  ctx: RequestContext,
  raw: CancelCorrectionInput,
): Promise<{ correctionId: string }> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.corrections.request");
  const projectId = requireProject(ctx);
  const input = cancelCorrectionInputSchema.parse(raw);

  return withFieldContext(db, ctx, async (tx) => {
    const [correction] = await tx
      .select({
        id: fieldSchema.surveyCorrection.id,
        state: fieldSchema.surveyCorrection.state,
        assignmentId: fieldSchema.surveyCorrection.correctionAssignmentId,
        originalInstanceId: fieldSchema.surveyCorrection.originalInstanceId,
      })
      .from(fieldSchema.surveyCorrection)
      .where(
        and(
          eq(fieldSchema.surveyCorrection.id, input.correctionId),
          eq(fieldSchema.surveyCorrection.projectId, projectId),
        ),
      );
    if (!correction) throw new NotFound("survey correction");
    if (correction.state !== "REQUESTED") {
      throw new InvalidInput(
        `this correction is ${correction.state.toLowerCase()} and cannot be cancelled. An applied ` +
          "correction is superseded by requesting another, never withdrawn.",
      );
    }

    const now = new Date();
    await tx
      .update(fieldSchema.surveyCorrection)
      .set({ state: "CANCELLED", cancelledAt: now, cancelledByUserId: ctx.userId })
      .where(eq(fieldSchema.surveyCorrection.id, correction.id));

    await tx
      .update(fieldSchema.fieldAssignment)
      .set({ status: "CANCELLED", cancelledAt: now })
      .where(eq(fieldSchema.fieldAssignment.id, correction.assignmentId));

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.survey.correction_cancelled",
        objectKind: "survey_correction",
        objectId: correction.id,
        details: { originalInstanceId: correction.originalInstanceId },
      },
    );

    return { correctionId: correction.id };
  });
}

/* ---------------------------------------------------------------------------------------------
 * applying — called from the submit path, never on its own
 * ------------------------------------------------------------------------------------------ */

/**
 * If this submitted response was captured on a correction's assignment, the correction is now
 * applied. Called inside `submitSurveyInstance`'s transaction.
 *
 * Idempotent by the same rule as the submit that calls it: an already-`APPLIED` correction is
 * left alone, so a retried offline submit does not settle it twice. The database refuses the second
 * write anyway (the trigger of migration 0051 §4), and being refused by a trigger is not a
 * mechanism — it is the backstop.
 */
export async function applyCorrectionIfAny(
  tx: DbTx,
  ctx: RequestContext,
  input: { readonly assignmentId: string; readonly instanceId: string; readonly projectId: string },
): Promise<{ correctionId: string; originalInstanceId: string } | null> {
  const [correction] = await tx
    .select({
      id: fieldSchema.surveyCorrection.id,
      state: fieldSchema.surveyCorrection.state,
      originalInstanceId: fieldSchema.surveyCorrection.originalInstanceId,
    })
    .from(fieldSchema.surveyCorrection)
    .where(eq(fieldSchema.surveyCorrection.correctionAssignmentId, input.assignmentId));

  if (!correction) return null;
  if (correction.state !== "REQUESTED") return null;

  await tx
    .update(fieldSchema.surveyCorrection)
    .set({
      state: "APPLIED",
      correctingInstanceId: input.instanceId,
      appliedAt: new Date(),
    })
    .where(eq(fieldSchema.surveyCorrection.id, correction.id));

  await recordAudit(
    tx,
    { tenantId: ctx.tenantId, projectId: input.projectId },
    { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
    {
      action: "field.survey.correction_applied",
      objectKind: "survey_correction",
      objectId: correction.id,
      details: {
        originalInstanceId: correction.originalInstanceId,
        correctingInstanceId: input.instanceId,
      },
    },
  );

  return { correctionId: correction.id, originalInstanceId: correction.originalInstanceId };
}

/* ---------------------------------------------------------------------------------------------
 * reading
 * ------------------------------------------------------------------------------------------ */

export interface CorrectionLineageEntry {
  readonly instanceId: string;
  readonly generation: number;
  readonly submittedAt: string | null;
  readonly technicianUserId: string;
  readonly technicianName: string | null;
  /** True for exactly one entry: the response the study currently means. */
  readonly effective: boolean;
  /** The correction that produced this entry; absent on the original. */
  readonly correction: {
    readonly id: string;
    readonly reason: string;
    readonly requestedAt: string;
    readonly requestedByName: string | null;
  } | null;
}

export interface CorrectionLineage {
  readonly rootInstanceId: string;
  readonly effectiveInstanceId: string;
  readonly entries: ReadonlyArray<CorrectionLineageEntry>;
  /** A correction asked for and not yet captured. Nothing about it changes a count. */
  readonly openCorrection: {
    readonly id: string;
    readonly reason: string;
    readonly requestedAt: string;
    readonly requestedByName: string | null;
    readonly assignmentId: string;
    readonly assignmentStatus: string;
    readonly state: CorrectionState;
  } | null;
}

/**
 * The whole history of one response: what was submitted, what replaced it, and why.
 *
 * Reachable to a caller who may read the response itself (`field.responses.read`) — the lineage is
 * a statement *about* a household's answers, so it lives behind the same door (SECURITY.md §10b).
 */
export async function loadCorrectionLineage(
  db: Database,
  ctx: RequestContext,
  instanceId: string,
): Promise<CorrectionLineage | null> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.responses.read");
  const projectId = requireProject(ctx);

  return withFieldContext(db, ctx, async (tx) => {
    const rootRow = await tx.execute<{ root_instance_id: string; effective_instance_id: string }>(
      sql`
        select eff.root_instance_id, eff.effective_instance_id
          from app.effective_survey_instance eff
         where eff.tenant_id = ${ctx.tenantId} and eff.project_id = ${projectId}
           and (eff.root_instance_id = ${instanceId} or eff.effective_instance_id = ${instanceId}
                or exists (select 1 from app.survey_correction c
                            where c.tenant_id = eff.tenant_id
                              and c.state = 'APPLIED'
                              and c.correcting_instance_id = ${instanceId}))
         limit 1
      `,
    );
    const root = rootRow.rows[0];
    if (!root) return null;

    const entries = await tx.execute<{
      instance_id: string;
      generation: number;
      submitted_at: Date | null;
      technician_user_id: string;
      technician_name: string | null;
      correction_id: string | null;
      reason: string | null;
      requested_at: Date | null;
      requested_by_name: string | null;
    }>(sql`
      with recursive walk as (
        select i.id as instance_id, 0 as generation, i.submitted_at, i.respondent_user_id,
               null::uuid as correction_id, null::text as reason,
               null::timestamptz as requested_at, null::uuid as requested_by_user_id
          from app.survey_instance i
         where i.tenant_id = ${ctx.tenantId} and i.id = ${root.root_instance_id}
        union all
        select i.id, w.generation + 1, i.submitted_at, i.respondent_user_id,
               c.id, c.reason, c.requested_at, c.requested_by_user_id
          from walk w
          join app.survey_correction c
            on c.tenant_id = ${ctx.tenantId} and c.original_instance_id = w.instance_id
           and c.state = 'APPLIED' and c.correcting_instance_id is not null
          join app.survey_instance i
            on i.tenant_id = ${ctx.tenantId} and i.id = c.correcting_instance_id
      )
      select w.instance_id, w.generation, w.submitted_at,
             w.respondent_user_id as technician_user_id,
             tech.name as technician_name,
             w.correction_id, w.reason, w.requested_at,
             asker.name as requested_by_name
        from walk w
        left join app.user tech on tech.id = w.respondent_user_id
        left join app.user asker on asker.id = w.requested_by_user_id
       order by w.generation
    `);

    const open = await tx.execute<{
      id: string;
      reason: string;
      requested_at: Date;
      requested_by_name: string | null;
      assignment_id: string;
      assignment_status: string;
      state: CorrectionState;
    }>(sql`
      select c.id, c.reason, c.requested_at, u.name as requested_by_name,
             c.correction_assignment_id as assignment_id,
             fa.status::text as assignment_status, c.state::text as state
        from app.survey_correction c
        join app.field_assignment fa
          on fa.tenant_id = c.tenant_id and fa.id = c.correction_assignment_id
        left join app.user u on u.id = c.requested_by_user_id
       where c.tenant_id = ${ctx.tenantId}
         and c.original_instance_id = ${root.effective_instance_id}
         and c.state = 'REQUESTED'
       limit 1
    `);
    const openRow = open.rows[0];

    return {
      rootInstanceId: root.root_instance_id,
      effectiveInstanceId: root.effective_instance_id,
      entries: entries.rows.map((row) => ({
        instanceId: row.instance_id,
        generation: row.generation,
        submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
        technicianUserId: row.technician_user_id,
        technicianName: row.technician_name,
        effective: row.instance_id === root.effective_instance_id,
        correction: row.correction_id
          ? {
              id: row.correction_id,
              reason: row.reason ?? "",
              requestedAt: new Date(row.requested_at as Date).toISOString(),
              requestedByName: row.requested_by_name,
            }
          : null,
      })),
      openCorrection: openRow
        ? {
            id: openRow.id,
            reason: openRow.reason,
            requestedAt: new Date(openRow.requested_at).toISOString(),
            requestedByName: openRow.requested_by_name,
            assignmentId: openRow.assignment_id,
            assignmentStatus: openRow.assignment_status,
            state: openRow.state,
          }
        : null,
    };
  });
}

/* ---------------------------------------------------------------------------------------------
 * internals
 * ------------------------------------------------------------------------------------------ */

interface CorrectableInstance {
  readonly id: string;
  readonly status: string;
  readonly assignmentId: string;
  readonly campaignId: string;
  readonly parcelId: string;
  readonly assigneeMembershipId: string;
  readonly assigneeUserId: string;
  readonly regime: string;
  readonly isEffective: boolean;
  readonly hasOpenCorrection: boolean;
}

async function readCorrectableInstance(
  tx: DbTx,
  ctx: RequestContext,
  instanceId: string,
): Promise<CorrectableInstance> {
  const rows = await tx.execute<{
    id: string;
    status: string;
    assignment_id: string;
    campaign_id: string;
    parcel_id: string;
    assignee_membership_id: string;
    assignee_user_id: string;
    regime: string;
    is_effective: boolean;
    has_open_correction: boolean;
  }>(sql`
    select i.id, i.status::text as status, i.assignment_id,
           fa.campaign_id, fa.parcel_id, fa.assignee_membership_id, fa.assignee_user_id,
           pr.regime::text as regime,
           exists (select 1 from app.effective_survey_instance eff
                    where eff.tenant_id = i.tenant_id and eff.effective_instance_id = i.id)
             as is_effective,
           exists (select 1 from app.survey_correction c
                    where c.tenant_id = i.tenant_id and c.original_instance_id = i.id
                      and c.state = 'REQUESTED') as has_open_correction
      from app.survey_instance i
      join app.field_assignment fa on fa.tenant_id = i.tenant_id and fa.id = i.assignment_id
      join app.provenance_record pr on pr.tenant_id = i.tenant_id and pr.id = i.provenance_id
     where i.tenant_id = ${ctx.tenantId} and i.id = ${instanceId}
     limit 1
  `);
  const row = rows.rows[0];
  // A response the caller cannot see is indistinguishable from one that does not exist (ADR-016).
  if (!row) throw new NotFound("survey response");
  return {
    id: row.id,
    status: row.status,
    assignmentId: row.assignment_id,
    campaignId: row.campaign_id,
    parcelId: row.parcel_id,
    assigneeMembershipId: row.assignee_membership_id,
    assigneeUserId: row.assignee_user_id,
    regime: row.regime,
    isEffective: row.is_effective,
    hasOpenCorrection: row.has_open_correction,
  };
}

async function readAssignee(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  membershipId: string,
): Promise<{ membershipId: string; userId: string }> {
  const rows = await tx.execute<{ id: string; user_id: string }>(sql`
    select pm.id, tm.user_id
      from app.project_membership pm
      join app.tenant_membership tm
        on tm.tenant_id = pm.tenant_id and tm.id = pm.tenant_membership_id
     where pm.tenant_id = ${ctx.tenantId} and pm.project_id = ${projectId}
       and pm.id = ${membershipId} and pm.status = 'active'
     limit 1
  `);
  const row = rows.rows[0];
  if (!row) throw new NotFound("project membership");
  return { membershipId: row.id, userId: row.user_id };
}
