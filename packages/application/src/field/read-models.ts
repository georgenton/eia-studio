import { type Database, type DbTx } from "@eia/db";
import {
  campaignProgress,
  NotFound,
  requireCapability,
  requirePermission,
  type AssignmentStatus,
  type CampaignProgress,
  type CampaignStatus,
  type CaptureChannel,
  type FieldOfflineMode,
  type InstanceStatus,
  type LocationOutcome,
  type ProvenanceFacets,
  type QuestionSensitivity,
  type QuestionType,
  type RequestContext,
  type SurveyVersionStatus,
  type VisitStatus,
} from "@eia/domain";
import { sql } from "drizzle-orm";

import { facetsOf, loadProvenanceRecords } from "../projects/provenance";
import { readsAllFieldResponses, withFieldContext } from "./context";

/**
 * FieldFlow read models.
 *
 * Two rules run through all of them.
 *
 * **Scope comes from the verified context.** Every query filters on `ctx.tenantId` and
 * `ctx.projectId`, and the RLS policies deny the row a second time — including the technician
 * ownership rule, which is why these all go through `withFieldContext`.
 *
 * **A technician's view is not a filtered coordinator's view.** `loadMyWork` and
 * `loadFieldOverview` are different functions rather than one function with a flag, because the
 * two answer different questions and the wrong default on a shared flag is a privacy incident.
 */

export interface FieldCampaignSummary {
  readonly id: string;
  readonly name: string;
  readonly status: CampaignStatus;
  readonly captureChannel: CaptureChannel;
  readonly offlineModeAtActivation: FieldOfflineMode | null;
  readonly surveyVersionId: string;
  readonly surveyVersionLabel: string;
  readonly surveyVersionStatus: SurveyVersionStatus;
  readonly surveyTemplateName: string;
  readonly startsOn: string | null;
  readonly targetOn: string | null;
  readonly progress: CampaignProgress;
  readonly submittedCount: number;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}

export interface TechnicianWorkload {
  readonly userId: string;
  readonly displayName: string;
  readonly pending: number;
  readonly inProgress: number;
  readonly completed: number;
}

export interface FieldOverview {
  readonly campaigns: ReadonlyArray<FieldCampaignSummary>;
  readonly workload: ReadonlyArray<TechnicianWorkload>;
}

/**
 * What a coordinator or social specialist sees: the campaigns, their progress and who is carrying
 * the work. Counts only — no individual response is read here, so a role with `field.read` and no
 * `field.responses.read` still gets a useful picture without seeing anyone's answers.
 */
export async function loadFieldOverview(db: Database, ctx: RequestContext): Promise<FieldOverview> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.read");
  if (ctx.projectId === null) throw new Error("loadFieldOverview requires a project context");
  const projectId = ctx.projectId;

  return withFieldContext(db, ctx, async (tx) => {
    const campaignRows = await tx.execute(sql`
      select c.id,
             c.name,
             c.status,
             c.capture_channel,
             c.offline_mode_at_activation,
             c.starts_on,
             c.target_on,
             c.provenance_id,
             v.id as version_id,
             v.version_label,
             v.status as version_status,
             t.name as template_name,
             coalesce(a.pending, 0)::int as pending,
             coalesce(a.in_progress, 0)::int as in_progress,
             coalesce(a.completed, 0)::int as completed,
             coalesce(a.cancelled, 0)::int as cancelled,
             coalesce(s.submitted, 0)::int as submitted
      from app.survey_campaign c
      join app.survey_version v on v.tenant_id = c.tenant_id and v.id = c.survey_version_id
      join app.survey_template t on t.tenant_id = v.tenant_id and t.id = v.template_id
      left join lateral (
        select count(*) filter (where fa.status = 'PENDING') as pending,
               count(*) filter (where fa.status = 'IN_PROGRESS') as in_progress,
               count(*) filter (where fa.status = 'COMPLETED') as completed,
               count(*) filter (where fa.status = 'CANCELLED') as cancelled
        from app.field_assignment fa
        where fa.tenant_id = c.tenant_id and fa.campaign_id = c.id
      ) a on true
      left join lateral (
        select count(*) as submitted
        from app.survey_instance si
        join app.field_assignment fa2
          on fa2.tenant_id = si.tenant_id and fa2.id = si.assignment_id
        where si.tenant_id = c.tenant_id
          and fa2.campaign_id = c.id
          and si.status = 'SUBMITTED'
      ) s on true
      where c.tenant_id = ${ctx.tenantId} and c.project_id = ${projectId}
      order by c.created_at desc
    `);

    const rows = campaignRows.rows as unknown as ReadonlyArray<{
      id: string;
      name: string;
      status: CampaignStatus;
      capture_channel: CaptureChannel;
      offline_mode_at_activation: FieldOfflineMode | null;
      starts_on: string | null;
      target_on: string | null;
      provenance_id: string;
      version_id: string;
      version_label: string;
      version_status: SurveyVersionStatus;
      template_name: string;
      pending: number;
      in_progress: number;
      completed: number;
      cancelled: number;
      submitted: number;
    }>;

    const provenance = await loadProvenanceRecords(
      tx,
      ctx,
      rows.map((row) => row.provenance_id),
    );

    const campaigns: FieldCampaignSummary[] = rows.map((row) => {
      const record = provenance.get(row.provenance_id);
      if (!record) throw new Error("provenance record missing for a survey campaign");
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        captureChannel: row.capture_channel,
        offlineModeAtActivation: row.offline_mode_at_activation,
        surveyVersionId: row.version_id,
        surveyVersionLabel: row.version_label,
        surveyVersionStatus: row.version_status,
        surveyTemplateName: row.template_name,
        startsOn: row.starts_on,
        targetOn: row.target_on,
        progress: campaignProgress({
          PENDING: row.pending,
          IN_PROGRESS: row.in_progress,
          COMPLETED: row.completed,
          CANCELLED: row.cancelled,
        }),
        submittedCount: row.submitted,
        provenanceId: row.provenance_id,
        provenance: facetsOf(record),
      };
    });

    // Workload is a count per technician, not a list of their responses. A coordinator needs to
    // know who is carrying what; that does not require reading anybody's answers.
    const workloadRows = await tx.execute(sql`
      select fa.assignee_user_id as user_id,
             coalesce(u.name, u.email) as display_name,
             count(*) filter (where fa.status = 'PENDING')::int as pending,
             count(*) filter (where fa.status = 'IN_PROGRESS')::int as in_progress,
             count(*) filter (where fa.status = 'COMPLETED')::int as completed
      from app.field_assignment fa
      join app."user" u on u.id = fa.assignee_user_id
      where fa.tenant_id = ${ctx.tenantId} and fa.project_id = ${projectId}
        and fa.status <> 'CANCELLED'
      group by fa.assignee_user_id, coalesce(u.name, u.email)
      order by 2
    `);

    return {
      campaigns,
      workload: workloadRows.rows as unknown as ReadonlyArray<TechnicianWorkload>,
    };
  });
}

export interface MyAssignment {
  readonly id: string;
  readonly status: AssignmentStatus;
  readonly campaignId: string;
  readonly campaignName: string;
  readonly parcelId: string;
  readonly parcelCode: string;
  readonly sectorLabel: string | null;
  readonly chainageM: number | null;
  readonly note: string | null;
  readonly surveyVersionId: string;
  readonly surveyVersionLabel: string;
  readonly openVisitId: string | null;
  readonly visitStatus: VisitStatus | null;
  readonly instanceId: string | null;
  readonly instanceStatus: InstanceStatus | null;
}

/**
 * The technician's own list. Scoped in the query *and* by RLS: a technician without
 * `field.responses.read` cannot see another technician's row even if this filter were removed.
 */
export async function loadMyWork(
  db: Database,
  ctx: RequestContext,
): Promise<ReadonlyArray<MyAssignment>> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.assignments.read_own");
  if (ctx.projectId === null) throw new Error("loadMyWork requires a project context");
  const projectId = ctx.projectId;

  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select fa.id,
             fa.status,
             fa.note,
             c.id as campaign_id,
             c.name as campaign_name,
             p.id as parcel_id,
             p.parcel_code,
             p.sector_label,
             p.chainage_m,
             v.id as version_id,
             v.version_label,
             open_visit.id as open_visit_id,
             open_visit.status as visit_status,
             si.id as instance_id,
             si.status as instance_status
      from app.field_assignment fa
      join app.survey_campaign c on c.tenant_id = fa.tenant_id and c.id = fa.campaign_id
      join app.survey_version v on v.tenant_id = c.tenant_id and v.id = c.survey_version_id
      join app.parcel p on p.tenant_id = fa.tenant_id and p.id = fa.parcel_id
      left join lateral (
        select fv.id, fv.status
        from app.field_visit fv
        where fv.tenant_id = fa.tenant_id and fv.assignment_id = fa.id
        order by fv.started_at desc
        limit 1
      ) open_visit on true
      left join app.survey_instance si
        on si.tenant_id = fa.tenant_id and si.assignment_id = fa.id
       and si.survey_version_id = v.id
      where fa.tenant_id = ${ctx.tenantId}
        and fa.project_id = ${projectId}
        and fa.assignee_user_id = ${ctx.userId}
        and c.status = 'ACTIVE'
        and fa.status <> 'CANCELLED'
      order by case fa.status when 'IN_PROGRESS' then 0 when 'PENDING' then 1 else 2 end,
               p.chainage_m nulls last, p.parcel_code
    `);

    return (
      rows.rows as unknown as ReadonlyArray<{
        id: string;
        status: AssignmentStatus;
        note: string | null;
        campaign_id: string;
        campaign_name: string;
        parcel_id: string;
        parcel_code: string;
        sector_label: string | null;
        chainage_m: string | null;
        version_id: string;
        version_label: string;
        open_visit_id: string | null;
        visit_status: VisitStatus | null;
        instance_id: string | null;
        instance_status: InstanceStatus | null;
      }>
    ).map((row) => ({
      id: row.id,
      status: row.status,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      parcelId: row.parcel_id,
      parcelCode: row.parcel_code,
      sectorLabel: row.sector_label,
      chainageM: row.chainage_m === null ? null : Number(row.chainage_m),
      note: row.note,
      surveyVersionId: row.version_id,
      surveyVersionLabel: row.version_label,
      openVisitId: row.open_visit_id,
      visitStatus: row.visit_status,
      instanceId: row.instance_id,
      instanceStatus: row.instance_status,
    }));
  });
}

export interface SurveyQuestionView {
  readonly id: string;
  readonly code: string;
  readonly ordinal: number;
  readonly type: QuestionType;
  readonly prompt: string;
  readonly helpText: string | null;
  readonly required: boolean;
  readonly sensitivity: QuestionSensitivity;
  readonly options: ReadonlyArray<{ id: string; code: string; label: string; ordinal: number }>;
}

export interface AssignmentDetail {
  readonly assignment: MyAssignment;
  readonly questions: ReadonlyArray<SurveyQuestionView>;
  /** Existing draft answers, keyed by question code. Empty until the technician saves. */
  readonly answers: Readonly<Record<string, AnswerView>>;
  readonly visit: {
    readonly id: string;
    readonly status: VisitStatus;
    readonly startedAt: Date;
    readonly completedAt: Date | null;
    readonly locationOutcome: LocationOutcome;
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly accuracyM: number | null;
  } | null;
}

export type AnswerView =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "date"; readonly value: string }
  | { readonly kind: "option"; readonly optionCode: string }
  | { readonly kind: "options"; readonly optionCodes: ReadonlyArray<string> };

/**
 * One assignment with the questionnaire it must be answered against and whatever draft exists.
 *
 * The questions come from the campaign's **published** version, resolved through the assignment,
 * so a client cannot name a version of its own. `NotFound` — not a denial — is what a caller gets
 * for an assignment that is not theirs, because a distinguishable denial would confirm it exists.
 */
export async function loadAssignmentDetail(
  db: Database,
  ctx: RequestContext,
  assignmentId: string,
): Promise<AssignmentDetail> {
  requireCapability(ctx, "field.surveys");
  if (!readsAllFieldResponses(ctx)) {
    requirePermission(ctx, "field.assignments.read_own");
  }
  if (ctx.projectId === null) throw new Error("loadAssignmentDetail requires a project context");
  const projectId = ctx.projectId;

  return withFieldContext(db, ctx, async (tx) => {
    const assignmentRows = await tx.execute(sql`
      select fa.id,
             fa.status,
             fa.note,
             c.id as campaign_id,
             c.name as campaign_name,
             p.id as parcel_id,
             p.parcel_code,
             p.sector_label,
             p.chainage_m,
             v.id as version_id,
             v.version_label,
             fv.id as open_visit_id,
             fv.status as visit_status,
             fv.started_at,
             fv.completed_at,
             fv.location_outcome,
             ST_Y(fv.location) as latitude,
             ST_X(fv.location) as longitude,
             fv.location_accuracy_m,
             si.id as instance_id,
             si.status as instance_status
      from app.field_assignment fa
      join app.survey_campaign c on c.tenant_id = fa.tenant_id and c.id = fa.campaign_id
      join app.survey_version v on v.tenant_id = c.tenant_id and v.id = c.survey_version_id
      join app.parcel p on p.tenant_id = fa.tenant_id and p.id = fa.parcel_id
      left join lateral (
        select fv2.* from app.field_visit fv2
        where fv2.tenant_id = fa.tenant_id and fv2.assignment_id = fa.id
        order by fv2.started_at desc limit 1
      ) fv on true
      left join app.survey_instance si
        on si.tenant_id = fa.tenant_id and si.assignment_id = fa.id and si.survey_version_id = v.id
      where fa.tenant_id = ${ctx.tenantId}
        and fa.project_id = ${projectId}
        and fa.id = ${assignmentId}
      limit 1
    `);
    const row = assignmentRows.rows[0] as unknown as
      | {
          id: string;
          status: AssignmentStatus;
          note: string | null;
          campaign_id: string;
          campaign_name: string;
          parcel_id: string;
          parcel_code: string;
          sector_label: string | null;
          chainage_m: string | null;
          version_id: string;
          version_label: string;
          open_visit_id: string | null;
          visit_status: VisitStatus | null;
          started_at: Date | null;
          completed_at: Date | null;
          location_outcome: LocationOutcome | null;
          latitude: number | null;
          longitude: number | null;
          location_accuracy_m: string | null;
          instance_id: string | null;
          instance_status: InstanceStatus | null;
        }
      | undefined;
    if (!row) throw new NotFound("field assignment");

    const questions = await loadSurveyQuestions(tx, ctx, row.version_id);
    const answers = row.instance_id
      ? await loadInstanceAnswers(tx, ctx, row.instance_id)
      : ({} as Record<string, AnswerView>);

    return {
      assignment: {
        id: row.id,
        status: row.status,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        parcelId: row.parcel_id,
        parcelCode: row.parcel_code,
        sectorLabel: row.sector_label,
        chainageM: row.chainage_m === null ? null : Number(row.chainage_m),
        note: row.note,
        surveyVersionId: row.version_id,
        surveyVersionLabel: row.version_label,
        openVisitId: row.open_visit_id,
        visitStatus: row.visit_status,
        instanceId: row.instance_id,
        instanceStatus: row.instance_status,
      },
      questions,
      answers,
      visit:
        row.open_visit_id && row.visit_status && row.started_at
          ? {
              id: row.open_visit_id,
              status: row.visit_status,
              startedAt: row.started_at,
              completedAt: row.completed_at,
              locationOutcome: row.location_outcome ?? "not_attempted",
              latitude: row.latitude,
              longitude: row.longitude,
              accuracyM: row.location_accuracy_m === null ? null : Number(row.location_accuracy_m),
            }
          : null,
    };
  });
}

/** The questionnaire definition of one version, in deterministic order. */
export async function loadSurveyQuestions(
  tx: DbTx,
  ctx: RequestContext,
  versionId: string,
): Promise<ReadonlyArray<SurveyQuestionView>> {
  const rows = await tx.execute(sql`
    select q.id, q.code, q.ordinal, q.type, q.prompt, q.help_text, q.required, q.sensitivity,
           coalesce(
             json_agg(
               json_build_object('id', o.id, 'code', o.code, 'label', o.label, 'ordinal', o.ordinal)
               order by o.ordinal
             ) filter (where o.id is not null),
             '[]'
           ) as options
    from app.survey_question q
    left join app.survey_option o on o.tenant_id = q.tenant_id and o.question_id = q.id
    where q.tenant_id = ${ctx.tenantId} and q.version_id = ${versionId}
    group by q.id, q.code, q.ordinal, q.type, q.prompt, q.help_text, q.required, q.sensitivity
    order by q.ordinal
  `);
  return (
    rows.rows as unknown as ReadonlyArray<{
      id: string;
      code: string;
      ordinal: number;
      type: QuestionType;
      prompt: string;
      help_text: string | null;
      required: boolean;
      sensitivity: QuestionSensitivity;
      options: ReadonlyArray<{ id: string; code: string; label: string; ordinal: number }>;
    }>
  ).map((row) => ({
    id: row.id,
    code: row.code,
    ordinal: row.ordinal,
    type: row.type,
    prompt: row.prompt,
    helpText: row.help_text,
    required: row.required,
    sensitivity: row.sensitivity,
    options: row.options,
  }));
}

async function loadInstanceAnswers(
  tx: DbTx,
  ctx: RequestContext,
  instanceId: string,
): Promise<Record<string, AnswerView>> {
  const rows = await tx.execute(sql`
    select q.code,
           q.type,
           a.text_value,
           a.number_value,
           a.boolean_value,
           a.date_value,
           o.code as option_code,
           coalesce(
             json_agg(mo.code order by mo.ordinal) filter (where mo.code is not null), '[]'
           ) as option_codes
    from app.survey_answer a
    join app.survey_question q on q.tenant_id = a.tenant_id and q.id = a.question_id
    left join app.survey_option o on o.tenant_id = a.tenant_id and o.id = a.option_id
    left join app.survey_answer_option sao
      on sao.tenant_id = a.tenant_id and sao.answer_id = a.id
    left join app.survey_option mo on mo.tenant_id = a.tenant_id and mo.id = sao.option_id
    where a.tenant_id = ${ctx.tenantId} and a.instance_id = ${instanceId}
    group by q.code, q.type, a.text_value, a.number_value, a.boolean_value, a.date_value, o.code
  `);

  const answers: Record<string, AnswerView> = {};
  for (const raw of rows.rows as unknown as ReadonlyArray<{
    code: string;
    type: QuestionType;
    text_value: string | null;
    number_value: string | null;
    boolean_value: boolean | null;
    date_value: string | null;
    option_code: string | null;
    option_codes: ReadonlyArray<string>;
  }>) {
    switch (raw.type) {
      case "SHORT_TEXT":
      case "LONG_TEXT":
        if (raw.text_value !== null) answers[raw.code] = { kind: "text", value: raw.text_value };
        break;
      case "INTEGER":
      case "DECIMAL":
        if (raw.number_value !== null) {
          answers[raw.code] = { kind: "number", value: Number(raw.number_value) };
        }
        break;
      case "BOOLEAN":
        if (raw.boolean_value !== null) {
          answers[raw.code] = { kind: "boolean", value: raw.boolean_value };
        }
        break;
      case "DATE":
        if (raw.date_value !== null) answers[raw.code] = { kind: "date", value: raw.date_value };
        break;
      case "SINGLE_CHOICE":
        if (raw.option_code !== null) {
          answers[raw.code] = { kind: "option", optionCode: raw.option_code };
        }
        break;
      case "MULTI_CHOICE":
        answers[raw.code] = { kind: "options", optionCodes: raw.option_codes };
        break;
    }
  }
  return answers;
}

export interface ParcelVisitEntry {
  readonly visitId: string;
  readonly technicianLabel: string;
  readonly status: VisitStatus;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly locationOutcome: LocationOutcome;
  readonly campaignName: string;
  readonly surveyVersionLabel: string;
  readonly instanceStatus: InstanceStatus | null;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}

/**
 * The Parcel Workspace's Visits tab.
 *
 * It reports **that** a visit happened and whether a response was submitted — never an answer. A
 * caller without `field.responses.read` sees only their own visits, because the RLS policy says
 * so; the tab is honest either way rather than pretending the parcel has no history.
 */
export async function loadParcelVisits(
  db: Database,
  ctx: RequestContext,
  parcelId: string,
): Promise<ReadonlyArray<ParcelVisitEntry>> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "parcels.read");
  if (ctx.projectId === null) throw new Error("loadParcelVisits requires a project context");
  const projectId = ctx.projectId;

  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select fv.id as visit_id,
             coalesce(u.name, u.email) as technician_label,
             fv.status,
             fv.started_at,
             fv.completed_at,
             fv.location_outcome,
             fv.provenance_id,
             c.name as campaign_name,
             v.version_label,
             si.status as instance_status
      from app.field_visit fv
      join app.field_assignment fa on fa.tenant_id = fv.tenant_id and fa.id = fv.assignment_id
      join app.survey_campaign c on c.tenant_id = fa.tenant_id and c.id = fa.campaign_id
      join app.survey_version v on v.tenant_id = c.tenant_id and v.id = c.survey_version_id
      join app."user" u on u.id = fv.technician_user_id
      left join app.survey_instance si
        on si.tenant_id = fv.tenant_id and si.assignment_id = fa.id
      where fv.tenant_id = ${ctx.tenantId}
        and fv.project_id = ${projectId}
        and fa.parcel_id = ${parcelId}
      order by fv.started_at desc
    `);

    const raw = rows.rows as unknown as ReadonlyArray<{
      visit_id: string;
      technician_label: string;
      status: VisitStatus;
      started_at: Date;
      completed_at: Date | null;
      location_outcome: LocationOutcome;
      provenance_id: string;
      campaign_name: string;
      version_label: string;
      instance_status: InstanceStatus | null;
    }>;

    const provenance = await loadProvenanceRecords(
      tx,
      ctx,
      raw.map((row) => row.provenance_id),
    );

    return raw.map((row) => {
      const record = provenance.get(row.provenance_id);
      if (!record) throw new Error("provenance record missing for a field visit");
      return {
        visitId: row.visit_id,
        technicianLabel: row.technician_label,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        locationOutcome: row.location_outcome,
        campaignName: row.campaign_name,
        surveyVersionLabel: row.version_label,
        instanceStatus: row.instance_status,
        provenanceId: row.provenance_id,
        provenance: facetsOf(record),
      };
    });
  });
}

export interface FieldProgressSummary {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly status: CampaignStatus;
  readonly progress: CampaignProgress;
  readonly submittedCount: number;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}

/**
 * The Command Center's field panel: counted from the campaign's own assignments, not from a
 * fixture. It is a *separate* observation from the study's historical survey aggregate, and it
 * carries its own provenance so the two can never read as one number.
 */
export async function loadFieldProgress(
  db: Database,
  ctx: RequestContext,
): Promise<FieldProgressSummary | null> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.read");
  if (ctx.projectId === null) throw new Error("loadFieldProgress requires a project context");

  const overview = await loadFieldOverview(db, ctx);
  const active =
    overview.campaigns.find((campaign) => campaign.status === "ACTIVE") ?? overview.campaigns[0];
  if (!active) return null;
  return {
    campaignId: active.id,
    campaignName: active.name,
    status: active.status,
    progress: active.progress,
    submittedCount: active.submittedCount,
    provenanceId: active.provenanceId,
    provenance: active.provenance,
  };
}
