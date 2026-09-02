import { appSchema, fieldSchema, type Database, type DbTx } from "@eia/db";
import {
  answerInputSchema,
  assertAssignmentTransition,
  assertCampaignActivatable,
  assertInstanceEditable,
  assertSubmissionComplete,
  NotFound,
  PermissionDenied,
  readFieldOfflineMode,
  requireCapability,
  requirePermission,
  validateAnswer,
  visitLocationSchema,
  type AnswerInput,
  type CampaignStatus,
  type CaptureChannel,
  type FieldOfflineMode,
  type InstanceStatus,
  type LocationOutcome,
  type RequestContext,
  type SurveyQuestionDefinition,
  type SurveyVersionStatus,
} from "@eia/domain";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { recordAudit } from "../audit/record";
import { withFieldContext } from "./context";
import { loadSurveyQuestions } from "./read-models";

/**
 * FieldFlow mutations.
 *
 * Everything a client sends is a *claim*. The technician id, the project, the assignment's
 * ownership, the survey version and the option codes all arrive from a browser and are all
 * re-resolved here from the verified `RequestContext` and the database. A hidden button is not
 * a security control; neither is a field the form did not render.
 *
 * Three specific protections, because they are the ones that cost real data when missing:
 *
 * - **Assignment ownership is re-checked at mutation time**, not at page load. A technician may
 *   only act on an assignment whose `assignee_user_id` is their own — asserted here and again by
 *   the RLS policy underneath.
 * - **The survey version comes from the campaign**, never from the request. A client cannot answer
 *   v1's questions against v2, or name a draft version.
 * - **Submission is one transaction** and idempotent by a unique key, so a double-tap on a phone
 *   with bad signal produces one response, not two households.
 */

/* ---------------------------------------------------------------------------------------------
 * shared resolution
 * ------------------------------------------------------------------------------------------ */

interface ResolvedAssignment {
  readonly id: string;
  readonly status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  readonly assigneeUserId: string;
  readonly campaignId: string;
  readonly campaignStatus: CampaignStatus;
  readonly parcelId: string;
  readonly surveyVersionId: string;
  readonly surveyVersionStatus: SurveyVersionStatus;
}

/**
 * Load an assignment the caller is actually entitled to act on.
 *
 * `NotFound` rather than a denial when it is someone else's: a distinguishable error would confirm
 * the assignment exists, which is exactly what a technician probing ids wants to learn.
 */
async function resolveAssignmentForCapture(
  tx: DbTx,
  ctx: RequestContext,
  assignmentId: string,
): Promise<ResolvedAssignment> {
  const rows = await tx.execute(sql`
    select fa.id, fa.status, fa.assignee_user_id, fa.parcel_id,
           c.id as campaign_id, c.status as campaign_status,
           v.id as version_id, v.status as version_status
    from app.field_assignment fa
    join app.survey_campaign c on c.tenant_id = fa.tenant_id and c.id = fa.campaign_id
    join app.survey_version v on v.tenant_id = c.tenant_id and v.id = c.survey_version_id
    where fa.tenant_id = ${ctx.tenantId}
      and fa.project_id = ${ctx.projectId}
      and fa.id = ${assignmentId}
    limit 1
  `);
  const row = rows.rows[0] as unknown as
    | {
        id: string;
        status: ResolvedAssignment["status"];
        assignee_user_id: string;
        parcel_id: string;
        campaign_id: string;
        campaign_status: CampaignStatus;
        version_id: string;
        version_status: SurveyVersionStatus;
      }
    | undefined;
  if (!row) throw new NotFound("field assignment");

  if (row.assignee_user_id !== ctx.userId) {
    // Re-checked here even though RLS already filtered: two layers, one failure still safe.
    throw new NotFound("field assignment");
  }
  if (row.status === "CANCELLED") {
    throw new NotFound("field assignment");
  }

  return {
    id: row.id,
    status: row.status,
    assigneeUserId: row.assignee_user_id,
    campaignId: row.campaign_id,
    campaignStatus: row.campaign_status,
    parcelId: row.parcel_id,
    surveyVersionId: row.version_id,
    surveyVersionStatus: row.version_status,
  };
}

/** Provenance for anything a technician captures through the demo FieldFlow (gate §14). */
async function createFieldProvenance(
  tx: DbTx,
  ctx: RequestContext,
  input: {
    readonly title: string;
    readonly note: string;
    readonly method: string;
    readonly demo: boolean;
  },
): Promise<string> {
  const id = randomUUID();
  await tx.insert(appSchema.provenanceRecord).values({
    id,
    tenantId: ctx.tenantId,
    projectId: ctx.projectId!,
    // The interaction really is a field-capture workflow; the person and the data are synthetic.
    // Both facts are true at once, and the record says both rather than picking the flattering one.
    regime: input.demo ? "DEMO_SIMULATION" : "LIVE_OPERATIONAL",
    origin: "FIELD_CAPTURE",
    transformations: ["ORIGINAL"],
    granularity: "INDIVIDUAL",
    title: input.title,
    note: input.note,
    method: input.method,
    capturedAt: new Date(),
    validationState: "PENDING",
  });
  return id;
}

/** Whether this project's field data is a demonstration, read from the campaign's provenance. */
async function campaignIsDemo(tx: DbTx, ctx: RequestContext, campaignId: string): Promise<boolean> {
  const rows = await tx.execute(sql`
    select pr.regime
    from app.survey_campaign c
    join app.provenance_record pr on pr.tenant_id = c.tenant_id and pr.id = c.provenance_id
    where c.tenant_id = ${ctx.tenantId} and c.id = ${campaignId}
    limit 1
  `);
  const row = rows.rows[0] as unknown as { regime: string } | undefined;
  return row?.regime === "DEMO_SIMULATION";
}

/* ---------------------------------------------------------------------------------------------
 * campaign activation
 * ------------------------------------------------------------------------------------------ */

export interface CampaignActivation {
  readonly campaignId: string;
  readonly status: CampaignStatus;
  readonly captureChannel: CaptureChannel;
  readonly offlineMode: FieldOfflineMode;
  readonly assignmentCount: number;
}

/**
 * Activate a campaign, which is where D-020 becomes visible.
 *
 * A project whose `field.surveys.offline_mode` is `required` cannot activate a campaign on the
 * native web channel, because that channel has no offline support and pretending otherwise costs
 * a technician a day of work in a valley with no signal. The failure is here, in an office, with a
 * sentence naming the channel and the policy.
 */
export async function activateCampaign(
  db: Database,
  ctx: RequestContext,
  campaignId: string,
): Promise<CampaignActivation> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.campaigns.manage");
  if (ctx.projectId === null) throw new Error("activateCampaign requires a project context");
  const projectId = ctx.projectId;

  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select c.id, c.status, c.capture_channel,
             v.status as version_status,
             (select count(*)::int from app.field_assignment fa
               where fa.tenant_id = c.tenant_id and fa.campaign_id = c.id
                 and fa.status <> 'CANCELLED') as assignment_count,
             (select cfg.value from app.project_configuration cfg
               where cfg.tenant_id = c.tenant_id and cfg.project_id = c.project_id
                 and cfg.key = 'field.surveys.offline_mode') as offline_mode
      from app.survey_campaign c
      join app.survey_version v on v.tenant_id = c.tenant_id and v.id = c.survey_version_id
      where c.tenant_id = ${ctx.tenantId} and c.project_id = ${projectId} and c.id = ${campaignId}
      limit 1
    `);
    const row = rows.rows[0] as unknown as
      | {
          id: string;
          status: CampaignStatus;
          capture_channel: CaptureChannel;
          version_status: SurveyVersionStatus;
          assignment_count: number;
          offline_mode: string | null;
        }
      | undefined;
    if (!row) throw new NotFound("survey campaign");

    const offlineMode = readFieldOfflineMode(row.offline_mode);

    // Throws CampaignNotActivatable or OfflineCaptureUnsupported, both with a readable message.
    assertCampaignActivatable({
      status: row.status,
      surveyVersionStatus: row.version_status,
      assignmentCount: row.assignment_count,
      captureChannel: row.capture_channel,
      offlineMode,
    });

    await tx
      .update(fieldSchema.surveyCampaign)
      .set({
        status: "ACTIVE",
        activatedAt: new Date(),
        offlineModeAtActivation: offlineMode,
      })
      .where(
        and(
          eq(fieldSchema.surveyCampaign.tenantId, ctx.tenantId),
          eq(fieldSchema.surveyCampaign.id, campaignId),
        ),
      );

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.campaign.activated",
        objectKind: "survey_campaign",
        objectId: campaignId,
        // Counts and policy, never a respondent or an answer.
        details: {
          captureChannel: row.capture_channel,
          offlineMode,
          assignmentCount: row.assignment_count,
        },
      },
    );

    return {
      campaignId,
      status: "ACTIVE" as const,
      captureChannel: row.capture_channel,
      offlineMode,
      assignmentCount: row.assignment_count,
    };
  });
}

/* ---------------------------------------------------------------------------------------------
 * visits
 * ------------------------------------------------------------------------------------------ */

export const startVisitInputSchema = z
  .object({
    assignmentId: z.string().uuid(),
    location: visitLocationSchema.nullable(),
    locationOutcome: z.enum(["captured", "denied", "unavailable", "not_attempted"]),
  })
  .strict();
export type StartVisitInput = z.infer<typeof startVisitInputSchema>;

export interface VisitResult {
  readonly visitId: string;
  readonly assignmentId: string;
  readonly status: "IN_PROGRESS" | "COMPLETED";
  readonly locationOutcome: LocationOutcome;
}

/**
 * Begin a visit, optionally recording where the technician was.
 *
 * Idempotent by intent: an assignment that already has an open visit returns that visit rather
 * than starting a second one, so a double-tap or a back-button does not fragment one field event
 * into two. Coordinates are validated, never trusted — a client can send anything — and a refused
 * or failed location is recorded as *why* rather than as a fabricated point.
 */
export async function startVisit(
  db: Database,
  ctx: RequestContext,
  raw: unknown,
): Promise<VisitResult> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.capture");
  if (ctx.projectId === null) throw new Error("startVisit requires a project context");
  const projectId = ctx.projectId;
  const input = startVisitInputSchema.parse(raw);

  if (input.location !== null && input.locationOutcome !== "captured") {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["locationOutcome"],
        message: "a location was supplied but the outcome does not say it was captured",
      },
    ]);
  }

  return withFieldContext(db, ctx, async (tx) => {
    const assignment = await resolveAssignmentForCapture(tx, ctx, input.assignmentId);
    if (assignment.campaignStatus !== "ACTIVE") {
      throw new PermissionDenied({
        role: ctx.projectRole ?? ctx.tenantRole,
        restrictedData: "field.capture",
      });
    }

    const open = await tx.execute(sql`
      select id, status, location_outcome from app.field_visit
      where tenant_id = ${ctx.tenantId} and assignment_id = ${assignment.id}
        and status = 'IN_PROGRESS'
      order by started_at desc limit 1
    `);
    const existing = open.rows[0] as unknown as
      { id: string; status: "IN_PROGRESS"; location_outcome: LocationOutcome } | undefined;
    if (existing) {
      return {
        visitId: existing.id,
        assignmentId: assignment.id,
        status: existing.status,
        locationOutcome: existing.location_outcome,
      };
    }

    const demo = await campaignIsDemo(tx, ctx, assignment.campaignId);
    const provenanceId = await createFieldProvenance(tx, ctx, {
      title: "Visita de campo",
      note:
        "Evento de campo registrado por el técnico asignado. La ubicación, cuando existe, es la " +
        "que reportó el navegador; nunca se inventa una.",
      method: "Captura web de EIA Studio; ubicación del navegador cuando el técnico la autoriza.",
      demo,
    });

    const visitId = randomUUID();
    await tx.execute(sql`
      insert into app.field_visit
        (id, tenant_id, project_id, assignment_id, technician_user_id, status, started_at,
         location, location_accuracy_m, location_captured_at, location_outcome, provenance_id)
      values (
        ${visitId}, ${ctx.tenantId}, ${projectId}, ${assignment.id}, ${ctx.userId},
        'IN_PROGRESS', now(),
        ${
          input.location
            ? sql`ST_SetSRID(ST_MakePoint(${input.location.longitude}, ${input.location.latitude}), 4326)`
            : sql`null`
        },
        ${input.location?.accuracyM ?? null},
        ${input.location?.capturedAt ?? null},
        ${input.locationOutcome},
        ${provenanceId}
      )
    `);

    if (assignment.status === "PENDING") {
      assertAssignmentTransition("PENDING", "IN_PROGRESS");
      await tx
        .update(fieldSchema.fieldAssignment)
        .set({ status: "IN_PROGRESS" })
        .where(
          and(
            eq(fieldSchema.fieldAssignment.tenantId, ctx.tenantId),
            eq(fieldSchema.fieldAssignment.id, assignment.id),
          ),
        );
    }

    return {
      visitId,
      assignmentId: assignment.id,
      status: "IN_PROGRESS" as const,
      locationOutcome: input.locationOutcome,
    };
  });
}

/**
 * Close a visit. Completing an already-completed visit returns it unchanged rather than moving the
 * timestamp, so a retried request cannot rewrite when the work happened.
 */
export async function completeVisit(
  db: Database,
  ctx: RequestContext,
  visitId: string,
): Promise<VisitResult> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.capture");
  if (ctx.projectId === null) throw new Error("completeVisit requires a project context");

  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select fv.id, fv.status, fv.assignment_id, fv.technician_user_id, fv.location_outcome
      from app.field_visit fv
      where fv.tenant_id = ${ctx.tenantId} and fv.project_id = ${ctx.projectId}
        and fv.id = ${visitId}
      limit 1
    `);
    const row = rows.rows[0] as unknown as
      | {
          id: string;
          status: "IN_PROGRESS" | "COMPLETED";
          assignment_id: string;
          technician_user_id: string;
          location_outcome: LocationOutcome;
        }
      | undefined;
    if (!row || row.technician_user_id !== ctx.userId) throw new NotFound("field visit");

    if (row.status === "COMPLETED") {
      return {
        visitId: row.id,
        assignmentId: row.assignment_id,
        status: row.status,
        locationOutcome: row.location_outcome,
      };
    }

    await tx
      .update(fieldSchema.fieldVisit)
      .set({ status: "COMPLETED", completedAt: new Date() })
      .where(
        and(
          eq(fieldSchema.fieldVisit.tenantId, ctx.tenantId),
          eq(fieldSchema.fieldVisit.id, visitId),
        ),
      );

    return {
      visitId: row.id,
      assignmentId: row.assignment_id,
      status: "COMPLETED" as const,
      locationOutcome: row.location_outcome,
    };
  });
}

/* ---------------------------------------------------------------------------------------------
 * responses
 * ------------------------------------------------------------------------------------------ */

export const answerMapSchema = z.record(z.string().min(1).max(40), answerInputSchema);

export const saveDraftInputSchema = z
  .object({
    assignmentId: z.string().uuid(),
    visitId: z.string().uuid().nullable(),
    answers: answerMapSchema,
  })
  .strict();
export type SaveDraftInput = z.infer<typeof saveDraftInputSchema>;

export interface InstanceResult {
  readonly instanceId: string;
  readonly assignmentId: string;
  readonly status: InstanceStatus;
  readonly surveyVersionId: string;
  /** True when the call found the work already done rather than doing it. */
  readonly alreadySubmitted: boolean;
}

async function questionsFor(
  tx: DbTx,
  ctx: RequestContext,
  versionId: string,
): Promise<{
  definitions: ReadonlyArray<SurveyQuestionDefinition>;
  optionIdByCode: Map<string, string>;
  questionIdByCode: Map<string, string>;
}> {
  const views = await loadSurveyQuestions(tx, ctx, versionId);
  const optionIdByCode = new Map<string, string>();
  const questionIdByCode = new Map<string, string>();
  const definitions = views.map((view) => {
    questionIdByCode.set(view.code, view.id);
    for (const option of view.options) optionIdByCode.set(`${view.code}:${option.code}`, option.id);
    return {
      code: view.code,
      ordinal: view.ordinal,
      type: view.type,
      prompt: view.prompt,
      helpText: view.helpText,
      required: view.required,
      sensitivity: view.sensitivity,
      options: view.options.map((option) => ({
        code: option.code,
        label: option.label,
        ordinal: option.ordinal,
      })),
    } satisfies SurveyQuestionDefinition;
  });
  return { definitions, optionIdByCode, questionIdByCode };
}

/** Replace this instance's answers with what the technician currently has on screen. */
async function writeAnswers(
  tx: DbTx,
  ctx: RequestContext,
  input: {
    instanceId: string;
    answers: ReadonlyMap<string, AnswerInput>;
    definitions: ReadonlyArray<SurveyQuestionDefinition>;
    optionIdByCode: Map<string, string>;
    questionIdByCode: Map<string, string>;
  },
): Promise<void> {
  const byCode = new Map(input.definitions.map((definition) => [definition.code, definition]));

  // A draft save is the whole form, so the previous set is replaced rather than merged: merging
  // would make a cleared answer indistinguishable from an untouched one.
  await tx.execute(sql`
    delete from app.survey_answer
    where tenant_id = ${ctx.tenantId} and instance_id = ${input.instanceId}
  `);

  for (const [code, answer] of input.answers) {
    const question = byCode.get(code);
    if (!question) continue;
    validateAnswer(question, answer);
    if (answer.kind === "blank") continue;
    if (answer.kind === "text" && answer.value.trim().length === 0) continue;
    if (answer.kind === "options" && answer.optionCodes.length === 0) continue;

    const questionId = input.questionIdByCode.get(code);
    if (!questionId) continue;
    const answerId = randomUUID();

    await tx.insert(fieldSchema.surveyAnswer).values({
      id: answerId,
      tenantId: ctx.tenantId,
      projectId: ctx.projectId!,
      instanceId: input.instanceId,
      questionId,
      textValue: answer.kind === "text" ? answer.value : null,
      numberValue: answer.kind === "number" ? String(answer.value) : null,
      booleanValue: answer.kind === "boolean" ? answer.value : null,
      dateValue: answer.kind === "date" ? answer.value : null,
      optionId:
        answer.kind === "option"
          ? (input.optionIdByCode.get(`${code}:${answer.optionCode}`) ?? null)
          : null,
    });

    if (answer.kind === "options") {
      for (const optionCode of answer.optionCodes) {
        const optionId = input.optionIdByCode.get(`${code}:${optionCode}`);
        if (!optionId) continue;
        await tx.insert(fieldSchema.surveyAnswerOption).values({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          projectId: ctx.projectId!,
          answerId,
          optionId,
        });
      }
    }
  }
}

/**
 * Save a draft. Required questions are **not** enforced here: a technician saving half a form
 * mid-visit is the normal case, and refusing it would push them to invent values.
 */
export async function saveSurveyDraft(
  db: Database,
  ctx: RequestContext,
  raw: unknown,
): Promise<InstanceResult> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.capture");
  if (ctx.projectId === null) throw new Error("saveSurveyDraft requires a project context");
  const projectId = ctx.projectId;
  const input = saveDraftInputSchema.parse(raw);

  return withFieldContext(db, ctx, async (tx) => {
    const assignment = await resolveAssignmentForCapture(tx, ctx, input.assignmentId);
    const instance = await ensureInstance(tx, ctx, assignment, input.visitId, projectId);
    assertInstanceEditable(instance.status, instance.id);

    const { definitions, optionIdByCode, questionIdByCode } = await questionsFor(
      tx,
      ctx,
      assignment.surveyVersionId,
    );
    await writeAnswers(tx, ctx, {
      instanceId: instance.id,
      answers: new Map(Object.entries(input.answers)),
      definitions,
      optionIdByCode,
      questionIdByCode,
    });

    return {
      instanceId: instance.id,
      assignmentId: assignment.id,
      status: "IN_PROGRESS" as const,
      surveyVersionId: assignment.surveyVersionId,
      alreadySubmitted: false,
    };
  });
}

async function ensureInstance(
  tx: DbTx,
  ctx: RequestContext,
  assignment: ResolvedAssignment,
  visitId: string | null,
  projectId: string,
): Promise<{ id: string; status: InstanceStatus }> {
  const existing = await tx.execute(sql`
    select id, status from app.survey_instance
    where tenant_id = ${ctx.tenantId}
      and assignment_id = ${assignment.id}
      and survey_version_id = ${assignment.surveyVersionId}
    limit 1
  `);
  const row = existing.rows[0] as unknown as { id: string; status: InstanceStatus } | undefined;
  if (row) return row;

  const demo = await campaignIsDemo(tx, ctx, assignment.campaignId);
  const provenanceId = await createFieldProvenance(tx, ctx, {
    title: "Respuesta de ficha socioeconómica",
    note:
      "Respuesta individual capturada en el flujo de campo. Los datos son sintéticos de " +
      "demostración; el flujo de captura es real.",
    method:
      "Capturada en el canal web de EIA Studio contra una versión publicada del cuestionario.",
    demo,
  });

  const id = randomUUID();
  await tx.insert(fieldSchema.surveyInstance).values({
    id,
    tenantId: ctx.tenantId,
    projectId,
    assignmentId: assignment.id,
    visitId,
    // From the campaign, never from the request: a client cannot choose which questionnaire its
    // answers are interpreted against.
    surveyVersionId: assignment.surveyVersionId,
    respondentUserId: ctx.userId,
    status: "IN_PROGRESS",
    provenanceId,
  });
  return { id, status: "IN_PROGRESS" };
}

export const submitInputSchema = z
  .object({
    assignmentId: z.string().uuid(),
    visitId: z.string().uuid().nullable(),
    answers: answerMapSchema,
  })
  .strict();

/**
 * Submit. One transaction, and idempotent: a response that is already `SUBMITTED` is returned as
 * a result rather than raised as an error, because the caller's intent — "this is submitted" — is
 * already true, and a retried request on a bad connection is the ordinary case.
 *
 * Required questions are enforced here, server-side. Frontend validation is a courtesy.
 */
export async function submitSurveyInstance(
  db: Database,
  ctx: RequestContext,
  raw: unknown,
): Promise<InstanceResult> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.capture");
  if (ctx.projectId === null) throw new Error("submitSurveyInstance requires a project context");
  const projectId = ctx.projectId;
  const input = submitInputSchema.parse(raw);

  return withFieldContext(db, ctx, async (tx) => {
    const assignment = await resolveAssignmentForCapture(tx, ctx, input.assignmentId);
    const instance = await ensureInstance(tx, ctx, assignment, input.visitId, projectId);

    if (instance.status === "SUBMITTED") {
      return {
        instanceId: instance.id,
        assignmentId: assignment.id,
        status: instance.status,
        surveyVersionId: assignment.surveyVersionId,
        alreadySubmitted: true,
      };
    }

    const { definitions, optionIdByCode, questionIdByCode } = await questionsFor(
      tx,
      ctx,
      assignment.surveyVersionId,
    );
    const answers = new Map(Object.entries(input.answers));

    // Types, option membership and required-ness, all against the version the campaign names.
    assertSubmissionComplete(definitions, answers);

    await writeAnswers(tx, ctx, {
      instanceId: instance.id,
      answers,
      definitions,
      optionIdByCode,
      questionIdByCode,
    });

    await tx
      .update(fieldSchema.surveyInstance)
      .set({ status: "SUBMITTED", submittedAt: new Date() })
      .where(
        and(
          eq(fieldSchema.surveyInstance.tenantId, ctx.tenantId),
          eq(fieldSchema.surveyInstance.id, instance.id),
        ),
      );

    if (assignment.status !== "COMPLETED") {
      assertAssignmentTransition(
        assignment.status === "PENDING" ? "PENDING" : "IN_PROGRESS",
        assignment.status === "PENDING" ? "IN_PROGRESS" : "COMPLETED",
      );
      await tx
        .update(fieldSchema.fieldAssignment)
        .set({ status: "COMPLETED", completedAt: new Date() })
        .where(
          and(
            eq(fieldSchema.fieldAssignment.tenantId, ctx.tenantId),
            eq(fieldSchema.fieldAssignment.id, assignment.id),
          ),
        );
    }

    if (input.visitId) {
      await tx.execute(sql`
        update app.field_visit
           set status = 'COMPLETED', completed_at = coalesce(completed_at, now())
         where tenant_id = ${ctx.tenantId} and id = ${input.visitId}
           and technician_user_id = ${ctx.userId} and status = 'IN_PROGRESS'
      `);
    }

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.survey.submitted",
        objectKind: "survey_instance",
        objectId: instance.id,
        // Identifiers and counts. Never an answer, and never a respondent's words.
        details: {
          assignmentId: assignment.id,
          surveyVersionId: assignment.surveyVersionId,
          answerCount: answers.size,
        },
      },
    );

    return {
      instanceId: instance.id,
      assignmentId: assignment.id,
      status: "SUBMITTED" as const,
      surveyVersionId: assignment.surveyVersionId,
      alreadySubmitted: false,
    };
  });
}
