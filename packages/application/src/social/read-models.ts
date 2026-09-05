import type { Database, DbTx } from "@eia/db";
import {
  confidenceBand,
  distributeValidated,
  isTabulated,
  NotFound,
  requireCapability,
  requirePermission,
  summariseAgreement,
  summariseNumeric,
  tabulateQuestion,
  type AgreementSummary,
  type QuestionTabulation,
  type QuestionType,
  type RequestContext,
  type TaxonomyDefinition,
  type ValidatedDistribution,
} from "@eia/domain";
import { sql } from "drizzle-orm";

import { withFieldContext } from "../field/context";
import { resolveCurrentCampaign } from "../field/read-models";

/**
 * Everything Social Intelligence reads.
 *
 * The tabulation half computes in SQL and shapes in the domain: the database counts rows, and
 * `tabulateQuestion` decides the denominator and the percentages. No model is consulted for any
 * number in this file, and the queue's ordering is arithmetic too.
 *
 * The coding half reads three separate things and never merges them: what a model proposed, what a
 * specialist decided, and how often the two coincided.
 *
 * ## Why even the aggregates need `field.responses.read`
 *
 * A tabulation is an aggregate, and an aggregate is not anybody's words — so `social.read` ought to
 * be enough. It is not, and the reason is worth stating rather than working around.
 *
 * These counts are computed from `survey_instance` and `survey_answer` through the runtime role,
 * under the same row level security that governs individual responses. A caller without
 * `field.responses.read` sees none of those rows, so every count comes back **zero** — not denied,
 * not partial: silently, plausibly zero. A screen that says "0 de 141 respuestas" to a viewer whose
 * project has 141 is worse than a screen that says "your role does not include this", because the
 * first one looks like a finding.
 *
 * So the permission is required here and the surface says so plainly. The alternative — a
 * published, project-level aggregate projection that carries no rows, in the shape the client
 * portal already uses — is the right long-term answer and is recorded as TD-045; inventing it now
 * would mean a second, staler copy of every figure before anything needs one.
 */
/**
 * Social Intelligence reads **the current operation**, not everything a project has ever captured
 * (ADR-026).
 *
 * A project accumulates campaigns. A campaign that ran and closed keeps its responses, and those
 * responses are real records of what happened — but adding them to today's denominator would make
 * a tabulation describe two operations at once, months apart, as though they were one sample. That
 * is the arithmetic error the denominator rules exist to prevent, arriving through the back door.
 *
 * The scope is a predicate rather than a filter applied afterwards, so a count and the list it
 * describes can never diverge: every `survey_instance` belongs to an assignment (`assignment_id`
 * is NOT NULL) and every assignment belongs to exactly one campaign.
 *
 * The historical 119 socioeconomic surveys of the concluded study are untouched by any of this:
 * they are a `HISTORICAL_OBSERVED` metric, not rows in these tables.
 */
function instanceInCampaign(alias: string, campaignId: string | null) {
  if (campaignId === null) return sql`false`;
  const a = sql.raw(alias);
  return sql`exists (
    select 1 from app.field_assignment fa_scope
     where fa_scope.tenant_id = ${a}.tenant_id
       and fa_scope.id = ${a}.assignment_id
       and fa_scope.campaign_id = ${campaignId}
  )`;
}

/** The same scope, reached from an answer id — for the tables that link to answers, not instances. */
function answerInCampaign(answerIdColumn: string, campaignId: string | null) {
  if (campaignId === null) return sql`false`;
  const column = sql.raw(answerIdColumn);
  return sql`exists (
    select 1
      from app.survey_answer a_scope
      join app.survey_instance i_scope
        on i_scope.tenant_id = a_scope.tenant_id and i_scope.id = a_scope.instance_id
      join app.field_assignment fa_scope
        on fa_scope.tenant_id = i_scope.tenant_id and fa_scope.id = i_scope.assignment_id
     where a_scope.tenant_id = i_scope.tenant_id
       and a_scope.id = ${column}
       and fa_scope.campaign_id = ${campaignId}
  )`;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SocialSurveyVersionOption {
  readonly versionId: string;
  readonly versionLabel: string;
  readonly templateName: string;
  readonly submitted: number;
}

export interface SocialTabulation {
  readonly versionId: string;
  readonly versionLabel: string;
  readonly templateName: string;
  readonly submitted: number;
  readonly questions: ReadonlyArray<QuestionTabulation>;
}

/**
 * Which questionnaire versions have submitted responses worth tabulating.
 *
 * The list exists because tabulation groups by version and refuses to add two together: a reader
 * chooses a version, and the screen says which one they are looking at (TD-039).
 */
export async function loadSocialVersions(
  db: Database,
  ctx: RequestContext,
): Promise<ReadonlyArray<SocialSurveyVersionOption>> {
  requireCapability(ctx, "social.analytics");
  requirePermission(ctx, "social.read");
  requirePermission(ctx, "field.responses.read");
  return withFieldContext(db, ctx, async (tx) => {
    // One current campaign *per version*, resolved the same way `resolveCurrentCampaign` does, so
    // the count beside a version is the count the tabulation of that version will show.
    const result = await tx.execute(sql`
      select v.id as version_id, v.version_label, t.name as template_name,
             coalesce((
               select count(*)::int from app.survey_instance i
                where i.tenant_id = v.tenant_id and i.survey_version_id = v.id
                  and i.status = 'SUBMITTED'
                  and exists (
                    select 1 from app.field_assignment fa
                     where fa.tenant_id = i.tenant_id and fa.id = i.assignment_id
                       and fa.campaign_id = cur.id
                  )
             ), 0) as submitted
        from app.survey_version v
        join app.survey_template t on t.tenant_id = v.tenant_id and t.id = v.template_id
        left join lateral (
          select c.id
            from app.survey_campaign c
           where c.tenant_id = v.tenant_id and c.project_id = v.project_id
             and c.survey_version_id = v.id
           order by (c.status = 'ACTIVE') desc, c.activated_at desc nulls last, c.created_at desc
           limit 1
        ) cur on true
       where v.tenant_id = ${ctx.tenantId} and v.project_id = ${ctx.projectId}
       order by v.version_label
    `);
    return (
      result.rows as Array<{
        version_id: string;
        version_label: string;
        template_name: string;
        submitted: number;
      }>
    ).map((row) => ({
      versionId: row.version_id,
      versionLabel: row.version_label,
      templateName: row.template_name,
      submitted: Number(row.submitted),
    }));
  });
}

/**
 * Closed-question tabulation for one survey version.
 *
 * Three counts per question, each computed separately rather than inferred from one another:
 * `submitted` (the universe), `answered` (rows for this question), and the per-option tallies.
 * Deriving "answered" from the sum of the option counts would be wrong for multi-choice — where
 * one respondent contributes several — which is exactly the mistake the denominator rules exist
 * to prevent.
 */
export async function loadTabulation(
  db: Database,
  ctx: RequestContext,
  surveyVersionId: string,
): Promise<SocialTabulation> {
  requireCapability(ctx, "social.analytics");
  requirePermission(ctx, "social.read");
  // See the note at the top of this file: without this the counts are silently zero.
  requirePermission(ctx, "field.responses.read");
  if (!UUID_SHAPE.test(surveyVersionId)) throw new NotFound("survey version not found");

  return withFieldContext(db, ctx, async (tx) => {
    const current = await resolveCurrentCampaign(tx, {
      tenantId: ctx.tenantId,
      projectId: ctx.projectId!,
      surveyVersionId,
    });
    const scope = instanceInCampaign("i", current?.id ?? null);
    const versionRows = await tx.execute(sql`
      select v.id, v.version_label, t.name as template_name
        from app.survey_version v
        join app.survey_template t on t.tenant_id = v.tenant_id and t.id = v.template_id
       where v.tenant_id = ${ctx.tenantId} and v.project_id = ${ctx.projectId}
         and v.id = ${surveyVersionId}
    `);
    const version = versionRows.rows[0] as
      { id: string; version_label: string; template_name: string } | undefined;
    if (!version) throw new NotFound("survey version not found");

    // The universe: submitted responses of this version. Drafts never take part (§4).
    const submittedRow = await tx.execute(sql`
      select count(*)::int as n from app.survey_instance i
       where i.tenant_id = ${ctx.tenantId} and i.project_id = ${ctx.projectId}
         and i.survey_version_id = ${surveyVersionId} and i.status = 'SUBMITTED'
         and ${scope}
    `);
    const submitted = Number((submittedRow.rows[0] as { n: number }).n);

    const questionRows = await tx.execute(sql`
      select q.id, q.code, q.prompt, q.type::text as type, q.ordinal
        from app.survey_question q
       where q.tenant_id = ${ctx.tenantId} and q.version_id = ${surveyVersionId}
       order by q.ordinal
    `);
    const questions = questionRows.rows as Array<{
      id: string;
      code: string;
      prompt: string;
      type: QuestionType;
      ordinal: number;
    }>;

    const tabulations: QuestionTabulation[] = [];
    for (const question of questions) {
      if (!isTabulated(question.type)) continue;

      // Answered: distinct submitted responses that answered this question. Counting answers
      // instead of responses would double-count a multi-choice respondent.
      const answeredRow = await tx.execute(sql`
        select count(distinct i.id)::int as n
          from app.survey_answer a
          join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
         where a.tenant_id = ${ctx.tenantId} and a.question_id = ${question.id}
           and i.status = 'SUBMITTED' and i.survey_version_id = ${surveyVersionId}
           and ${scope}
      `);
      const answered = Number((answeredRow.rows[0] as { n: number }).n);

      const tallies: Array<{ code: string; label: string; count: number }> = [];
      let numeric = null;

      if (question.type === "SINGLE_CHOICE") {
        const rows = await tx.execute(sql`
          select o.code, o.label, count(*)::int as n
            from app.survey_answer a
            join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
            join app.survey_option o on o.tenant_id = a.tenant_id and o.id = a.option_id
           where a.tenant_id = ${ctx.tenantId} and a.question_id = ${question.id}
             and i.status = 'SUBMITTED' and i.survey_version_id = ${surveyVersionId}
             and ${scope}
           and ${scope}
           group by o.code, o.label, o.ordinal
           order by o.ordinal
        `);
        tallies.push(...toTallies(rows.rows));
      } else if (question.type === "MULTI_CHOICE") {
        const rows = await tx.execute(sql`
          select o.code, o.label, count(*)::int as n
            from app.survey_answer_option link
            join app.survey_answer a on a.tenant_id = link.tenant_id and a.id = link.answer_id
            join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
            join app.survey_option o on o.tenant_id = link.tenant_id and o.id = link.option_id
           where link.tenant_id = ${ctx.tenantId} and a.question_id = ${question.id}
             and i.status = 'SUBMITTED' and i.survey_version_id = ${surveyVersionId}
             and ${scope}
           and ${scope}
           group by o.code, o.label, o.ordinal
           order by o.ordinal
        `);
        tallies.push(...toTallies(rows.rows));
      } else if (question.type === "BOOLEAN") {
        const rows = await tx.execute(sql`
          select a.boolean_value as value, count(*)::int as n
            from app.survey_answer a
            join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
           where a.tenant_id = ${ctx.tenantId} and a.question_id = ${question.id}
             and i.status = 'SUBMITTED' and i.survey_version_id = ${surveyVersionId}
             and ${scope}
           and ${scope}
             and a.boolean_value is not null
           group by a.boolean_value
        `);
        const counts = new Map<boolean, number>();
        for (const row of rows.rows as Array<{ value: boolean; n: number }>) {
          counts.set(row.value, Number(row.n));
        }
        tallies.push(
          { code: "true", label: "Sí", count: counts.get(true) ?? 0 },
          { code: "false", label: "No", count: counts.get(false) ?? 0 },
        );
      } else {
        const rows = await tx.execute(sql`
          select a.number_value as value
            from app.survey_answer a
            join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
           where a.tenant_id = ${ctx.tenantId} and a.question_id = ${question.id}
             and i.status = 'SUBMITTED' and i.survey_version_id = ${surveyVersionId}
             and ${scope}
           and ${scope}
             and a.number_value is not null
        `);
        numeric = summariseNumeric(
          (rows.rows as Array<{ value: string | number }>).map((row) => Number(row.value)),
        );
      }

      tabulations.push(
        tabulateQuestion({
          questionId: question.id,
          code: question.code,
          prompt: question.prompt,
          type: question.type,
          submitted,
          answered,
          tallies,
          numeric,
        }),
      );
    }

    return {
      versionId: version.id,
      versionLabel: version.version_label,
      templateName: version.template_name,
      submitted,
      questions: tabulations,
    };
  });
}

function toTallies(
  rows: ReadonlyArray<Record<string, unknown>>,
): Array<{ code: string; label: string; count: number }> {
  return (rows as Array<{ code: string; label: string; n: number }>).map((row) => ({
    code: row.code,
    label: row.label,
    count: Number(row.n),
  }));
}

/** The published taxonomy definition a run or a review was made against. */
export async function loadTaxonomyDefinition(
  tx: DbTx,
  ctx: RequestContext,
  versionId: string,
): Promise<TaxonomyDefinition> {
  if (!UUID_SHAPE.test(versionId)) throw new NotFound("taxonomy version not found");
  const versionRows = await tx.execute(sql`
    select id, version_label, status::text as status
      from app.taxonomy_version
     where tenant_id = ${ctx.tenantId} and project_id = ${ctx.projectId} and id = ${versionId}
  `);
  const version = versionRows.rows[0] as
    { id: string; version_label: string; status: string } | undefined;
  if (!version) throw new NotFound("taxonomy version not found");

  const categoryRows = await tx.execute(sql`
    select code, label, description, ordinal
      from app.taxonomy_category
     where tenant_id = ${ctx.tenantId} and version_id = ${versionId}
     order by ordinal
  `);
  return {
    versionId: version.id,
    versionLabel: version.version_label,
    categories: (
      categoryRows.rows as Array<{
        code: string;
        label: string;
        description: string;
        ordinal: number;
      }>
    ).map((row) => ({ ...row, ordinal: Number(row.ordinal) })),
  };
}

export interface OpenResponseRow {
  readonly answerId: string;
  readonly text: string;
  readonly questionPrompt: string;
  readonly surveyVersionLabel: string;
  readonly classificationId: string | null;
  readonly classificationStatus: string | null;
  readonly confidence: number | null;
  readonly confidenceBand: "low" | "medium" | "high" | "unknown";
  readonly needsReview: boolean;
  readonly error: string | null;
  readonly proposed: ReadonlyArray<{ code: string; label: string }>;
  readonly reviewId: string | null;
  readonly reviewDecision: "ACCEPTED" | "CORRECTED" | null;
  readonly finalCategories: ReadonlyArray<{ code: string; label: string }>;
}

/**
 * The open-response queue.
 *
 * Note what a row carries and what it does not: the response text, its question and version, the
 * proposal and the decision. No respondent, no technician, no parcel, no location — the queue is
 * about what was said, and everything else would be an unnecessary widening of who can be
 * identified from a screen that specialists keep open all day (§37).
 */
export async function loadOpenResponses(
  db: Database,
  ctx: RequestContext,
  input: { surveyVersionId: string; questionId?: string },
): Promise<ReadonlyArray<OpenResponseRow>> {
  requireCapability(ctx, "social.analytics");
  requirePermission(ctx, "social.read");
  // Individual words: the same boundary that governs the answers themselves.
  requirePermission(ctx, "field.responses.read");
  if (!UUID_SHAPE.test(input.surveyVersionId)) throw new NotFound("survey version not found");

  return withFieldContext(db, ctx, async (tx) => {
    const current = await resolveCurrentCampaign(tx, {
      tenantId: ctx.tenantId,
      projectId: ctx.projectId!,
      surveyVersionId: input.surveyVersionId,
    });
    const scope = instanceInCampaign("i", current?.id ?? null);
    // One row per *answer*, carrying its most recent proposal.
    //
    // A second run over the same question is a legitimate thing to do — a new model, a refined
    // prompt, a new taxonomy version — and it creates a second classification for the same answer.
    // Joining them all would show the same response several times in the queue, which is both
    // confusing and, worse, would count that response several times in the workflow figures. The
    // history is not lost: every run and every proposal stays in the tables, and the runs panel
    // lists them. The queue shows what there is to review now.
    const rows = await tx.execute(sql`
      with latest as (
        select distinct on (c.answer_id)
               c.answer_id, c.id, c.status, c.confidence, c.needs_review, c.error
          from app.ai_classification c
         where c.tenant_id = ${ctx.tenantId} and c.project_id = ${ctx.projectId}
         order by c.answer_id, c.created_at desc, c.id desc
      )
      select a.id                    as answer_id,
             a.text_value            as text,
             q.prompt                as question_prompt,
             v.version_label         as version_label,
             latest.id               as classification_id,
             latest.status::text     as classification_status,
             latest.confidence       as confidence,
             latest.needs_review     as needs_review,
             latest.error            as error,
             h.id                    as review_id,
             h.decision::text        as review_decision
        from app.survey_answer a
        join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
        join app.survey_version v on v.tenant_id = i.tenant_id and v.id = i.survey_version_id
        join app.survey_question q on q.tenant_id = a.tenant_id and q.id = a.question_id
        left join latest on latest.answer_id = a.id
        left join app.human_review h
               on h.tenant_id = a.tenant_id and h.classification_id = latest.id
       where a.tenant_id = ${ctx.tenantId} and a.project_id = ${ctx.projectId}
         and i.status = 'SUBMITTED'
         and i.survey_version_id = ${input.surveyVersionId}
         and ${scope}
         and q.type in ('SHORT_TEXT', 'LONG_TEXT')
         and a.text_value is not null
         and length(btrim(a.text_value)) > 0
         ${input.questionId ? sql`and a.question_id = ${input.questionId}` : sql``}
       order by latest.confidence nulls first, a.id
    `);

    const list = rows.rows as Array<{
      answer_id: string;
      text: string;
      question_prompt: string;
      version_label: string;
      classification_id: string | null;
      classification_status: string | null;
      confidence: string | null;
      needs_review: boolean | null;
      error: string | null;
      review_id: string | null;
      review_decision: "ACCEPTED" | "CORRECTED" | null;
    }>;
    if (list.length === 0) return [];

    const proposals = await categoriesByOwner(
      tx,
      ctx.tenantId,
      "ai_classification_category",
      "classification_id",
      list.map((row) => row.classification_id).filter((id): id is string => id !== null),
    );
    const finals = await categoriesByOwner(
      tx,
      ctx.tenantId,
      "human_review_category",
      "review_id",
      list.map((row) => row.review_id).filter((id): id is string => id !== null),
    );

    return list.map((row) => {
      const confidence = row.confidence === null ? null : Number(row.confidence);
      return {
        answerId: row.answer_id,
        text: row.text,
        questionPrompt: row.question_prompt,
        surveyVersionLabel: row.version_label,
        classificationId: row.classification_id,
        classificationStatus: row.classification_status,
        confidence,
        confidenceBand: confidenceBand(confidence),
        needsReview: row.needs_review ?? false,
        error: row.error,
        proposed: row.classification_id ? (proposals.get(row.classification_id) ?? []) : [],
        reviewId: row.review_id,
        reviewDecision: row.review_decision,
        finalCategories: row.review_id ? (finals.get(row.review_id) ?? []) : [],
      };
    });
  });
}

async function categoriesByOwner(
  tx: DbTx,
  tenantId: string,
  table: "ai_classification_category" | "human_review_category",
  ownerColumn: "classification_id" | "review_id",
  ownerIds: ReadonlyArray<string>,
): Promise<Map<string, Array<{ code: string; label: string }>>> {
  const byOwner = new Map<string, Array<{ code: string; label: string }>>();
  if (ownerIds.length === 0) return byOwner;
  const rows = await tx.execute(sql`
    select link.${sql.raw(ownerColumn)} as owner_id, cat.code, cat.label, cat.ordinal
      from app.${sql.raw(table)} link
      join app.taxonomy_category cat on cat.tenant_id = link.tenant_id and cat.id = link.category_id
     where link.tenant_id = ${tenantId}
       and link.${sql.raw(ownerColumn)} in (${sql.join(
         [...new Set(ownerIds)].map((id) => sql`${id}`),
         sql`, `,
       )})
     order by cat.ordinal
  `);
  for (const row of rows.rows as Array<{ owner_id: string; code: string; label: string }>) {
    const list = byOwner.get(row.owner_id) ?? [];
    list.push({ code: row.code, label: row.label });
    byOwner.set(row.owner_id, list);
  }
  return byOwner;
}

/**
 * The open-text question a run codes.
 *
 * Resolved on the server from the survey version, never taken from a request: a client that could
 * name the question could aim a run at a different one than the queue displays, and the run record
 * would then describe work nobody reviewed.
 */
export async function loadOpenQuestion(
  db: Database,
  ctx: RequestContext,
  surveyVersionId: string,
): Promise<string | null> {
  requireCapability(ctx, "social.analytics");
  requirePermission(ctx, "social.read");
  if (!UUID_SHAPE.test(surveyVersionId)) throw new NotFound("survey version not found");

  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select id from app.survey_question
       where tenant_id = ${ctx.tenantId} and version_id = ${surveyVersionId}
         and type in ('SHORT_TEXT', 'LONG_TEXT')
       order by ordinal
       limit 1
    `);
    return (rows.rows[0] as { id: string } | undefined)?.id ?? null;
  });
}

export interface SocialWorkflowMetrics {
  readonly eligible: number;
  readonly pendingAi: number;
  readonly processingAi: number;
  readonly succeededAi: number;
  readonly failedAi: number;
  readonly pendingReview: number;
  readonly reviewed: number;
  readonly lowConfidence: number;
  readonly agreement: AgreementSummary;
  readonly medianLatencyMs: number | null;
  readonly totalTokens: number | null;
}

/** Workflow counts. Every figure is a count of rows or a ratio of two counts. */
export async function loadSocialMetrics(
  db: Database,
  ctx: RequestContext,
  surveyVersionId: string,
): Promise<SocialWorkflowMetrics> {
  requireCapability(ctx, "social.analytics");
  requirePermission(ctx, "social.read");
  requirePermission(ctx, "field.responses.read");

  return withFieldContext(db, ctx, async (tx) => {
    const current = await resolveCurrentCampaign(tx, {
      tenantId: ctx.tenantId,
      projectId: ctx.projectId!,
      surveyVersionId,
    });
    const scope = instanceInCampaign("i", current?.id ?? null);
    // Counted per answer, over the most recent proposal for each — the same rule the queue uses,
    // so a figure and the list it describes can never disagree. Latency and tokens are summed over
    // every call the project actually made, because those are costs, not states.
    const counts = await tx.execute(sql`
      with eligible as (
        select a.id
          from app.survey_answer a
          join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
          join app.survey_question q on q.tenant_id = a.tenant_id and q.id = a.question_id
         where a.tenant_id = ${ctx.tenantId} and a.project_id = ${ctx.projectId}
           and i.status = 'SUBMITTED' and i.survey_version_id = ${surveyVersionId}
           and ${scope}
           and q.type in ('SHORT_TEXT', 'LONG_TEXT')
           and a.text_value is not null and length(btrim(a.text_value)) > 0
      ),
      latest as (
        select distinct on (c.answer_id) c.answer_id, c.id, c.status, c.confidence
          from app.ai_classification c
         where c.tenant_id = ${ctx.tenantId} and c.project_id = ${ctx.projectId}
           and c.answer_id in (select id from eligible)
         order by c.answer_id, c.created_at desc, c.id desc
      ),
      usage as (
        select percentile_cont(0.5) within group (order by c.latency_ms) as median_latency,
               sum(c.total_tokens)::int as total_tokens
          from app.ai_classification c
         where c.tenant_id = ${ctx.tenantId} and c.project_id = ${ctx.projectId}
           and c.answer_id in (select id from eligible)
      )
      select (select count(*) from eligible)::int as eligible,
             count(*) filter (where l.status = 'PENDING')::int    as pending_ai,
             count(*) filter (where l.status = 'PROCESSING')::int as processing_ai,
             count(*) filter (where l.status = 'SUCCEEDED')::int  as succeeded_ai,
             count(*) filter (where l.status = 'FAILED')::int     as failed_ai,
             count(*) filter (where l.status = 'SUCCEEDED' and h.id is null)::int as pending_review,
             count(*) filter (where h.id is not null)::int        as reviewed,
             count(*) filter (where l.confidence is not null and l.confidence < 0.6)::int
                                                                  as low_confidence,
             (select median_latency from usage)                   as median_latency,
             (select total_tokens from usage)                     as total_tokens
        from latest l
        left join app.human_review h on h.tenant_id = ${ctx.tenantId} and h.classification_id = l.id
    `);
    const row = counts.rows[0] as Record<string, number | string | null>;

    // Agreement is computed from the label sets themselves rather than from the stored decision,
    // so the two can be checked against each other and neither is taken on trust.
    const pairs = await tx.execute(sql`
      select h.id as review_id,
             array(select cat.code from app.ai_classification_category l
                     join app.taxonomy_category cat
                       on cat.tenant_id = l.tenant_id and cat.id = l.category_id
                    where l.tenant_id = h.tenant_id and l.classification_id = h.classification_id)
               as proposed,
             array(select cat.code from app.human_review_category l
                     join app.taxonomy_category cat
                       on cat.tenant_id = l.tenant_id and cat.id = l.category_id
                    where l.tenant_id = h.tenant_id and l.review_id = h.id)
               as final
        from app.human_review h
       where h.tenant_id = ${ctx.tenantId} and h.project_id = ${ctx.projectId}
    `);
    const comparisons = (pairs.rows as Array<{ proposed: string[]; final: string[] }>).map((pair) =>
      compare(pair.proposed ?? [], pair.final ?? []),
    );

    return {
      eligible: Number(row.eligible ?? 0),
      pendingAi: Number(row.pending_ai ?? 0),
      processingAi: Number(row.processing_ai ?? 0),
      succeededAi: Number(row.succeeded_ai ?? 0),
      failedAi: Number(row.failed_ai ?? 0),
      pendingReview: Number(row.pending_review ?? 0),
      reviewed: Number(row.reviewed ?? 0),
      lowConfidence: Number(row.low_confidence ?? 0),
      agreement: summariseAgreement(comparisons),
      medianLatencyMs: row.median_latency === null ? null : Math.round(Number(row.median_latency)),
      totalTokens: row.total_tokens === null ? null : Number(row.total_tokens),
    };
  });
}

function compare(proposed: ReadonlyArray<string>, final: ReadonlyArray<string>) {
  const proposedSet = new Set(proposed);
  const finalSet = new Set(final);
  const added = [...finalSet].filter((code) => !proposedSet.has(code)).sort();
  const removed = [...proposedSet].filter((code) => !finalSet.has(code)).sort();
  return {
    exactMatch: added.length === 0 && removed.length === 0,
    added,
    removed,
    kept: [...finalSet].filter((code) => proposedSet.has(code)).sort(),
  };
}

/**
 * The validated theme distribution — human labels only — and, separately, the provisional one.
 *
 * They are returned as two objects rather than one merged list, because the moment they share a
 * denominator the product has published an unvalidated figure as a result (§29, §51).
 */
export interface SocialDistributions {
  readonly validated: ValidatedDistribution;
  readonly provisional: ValidatedDistribution;
}

export async function loadDistributions(
  db: Database,
  ctx: RequestContext,
  surveyVersionId: string,
): Promise<SocialDistributions> {
  requireCapability(ctx, "social.analytics");
  requirePermission(ctx, "social.read");
  requirePermission(ctx, "field.responses.read");

  return withFieldContext(db, ctx, async (tx) => {
    const current = await resolveCurrentCampaign(tx, {
      tenantId: ctx.tenantId,
      projectId: ctx.projectId!,
      surveyVersionId,
    });
    const validatedRows = await tx.execute(sql`
      select cat.code, cat.label, count(*)::int as n
        from app.human_review_category link
        join app.human_review h on h.tenant_id = link.tenant_id and h.id = link.review_id
        join app.taxonomy_category cat on cat.tenant_id = link.tenant_id and cat.id = link.category_id
       where link.tenant_id = ${ctx.tenantId} and link.project_id = ${ctx.projectId}
         and ${answerInCampaign("h.answer_id", current?.id ?? null)}
       group by cat.code, cat.label, cat.ordinal
       order by cat.ordinal
    `);
    const provisionalRows = await tx.execute(sql`
      with latest as (
        select distinct on (c.answer_id) c.id
          from app.ai_classification c
         where c.tenant_id = ${ctx.tenantId} and c.project_id = ${ctx.projectId}
           and c.status = 'SUCCEEDED'
         order by c.answer_id, c.created_at desc, c.id desc
      )
      select cat.code, cat.label, count(*)::int as n
        from app.ai_classification_category link
        join latest on latest.id = link.classification_id
        join app.ai_classification c2
          on c2.tenant_id = link.tenant_id and c2.id = link.classification_id
        join app.taxonomy_category cat on cat.tenant_id = link.tenant_id and cat.id = link.category_id
       where link.tenant_id = ${ctx.tenantId} and link.project_id = ${ctx.projectId}
         and ${answerInCampaign("c2.answer_id", current?.id ?? null)}
       group by cat.code, cat.label, cat.ordinal
       order by cat.ordinal
    `);

    const metrics = await loadSocialMetrics(db, ctx, surveyVersionId);
    return {
      validated: distributeValidated({
        reviewed: metrics.reviewed,
        unreviewed: metrics.pendingReview,
        tallies: toTallies(validatedRows.rows),
      }),
      provisional: distributeValidated({
        reviewed: metrics.succeededAi,
        unreviewed: metrics.pendingAi + metrics.failedAi,
        tallies: toTallies(provisionalRows.rows),
      }),
    };
  });
}

export interface TaxonomyVersionSummary {
  readonly versionId: string;
  readonly versionLabel: string;
  readonly status: string;
  readonly sourceNote: string | null;
  readonly definitionHash: string | null;
  readonly categories: ReadonlyArray<{
    code: string;
    label: string;
    description: string;
    ordinal: number;
  }>;
}

/** The published taxonomy this project codes against, for the review panel and the run form. */
export async function loadPublishedTaxonomy(
  db: Database,
  ctx: RequestContext,
): Promise<TaxonomyVersionSummary | null> {
  requireCapability(ctx, "social.analytics");
  requirePermission(ctx, "social.read");

  return withFieldContext(db, ctx, async (tx) => {
    const versionRows = await tx.execute(sql`
      select id, version_label, status::text as status, source_note, definition_hash
        from app.taxonomy_version
       where tenant_id = ${ctx.tenantId} and project_id = ${ctx.projectId} and status = 'PUBLISHED'
       order by version_label desc
       limit 1
    `);
    const version = versionRows.rows[0] as
      | {
          id: string;
          version_label: string;
          status: string;
          source_note: string | null;
          definition_hash: string | null;
        }
      | undefined;
    if (!version) return null;

    const definition = await loadTaxonomyDefinition(tx, ctx, version.id);
    return {
      versionId: version.id,
      versionLabel: version.version_label,
      status: version.status,
      sourceNote: version.source_note,
      definitionHash: version.definition_hash,
      categories: definition.categories,
    };
  });
}

export interface ClassificationRunSummary {
  readonly runId: string;
  readonly status: string;
  readonly requestedModel: string;
  readonly resolvedModel: string | null;
  readonly classifierKind: string;
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly taxonomyVersionLabel: string;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly queued: number;
  readonly succeeded: number;
  readonly failed: number;
}

/** Run history: which configuration produced which proposals, newest first. */
export async function loadRuns(
  db: Database,
  ctx: RequestContext,
): Promise<ReadonlyArray<ClassificationRunSummary>> {
  requireCapability(ctx, "social.ai_coding");
  requirePermission(ctx, "social.read");

  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select r.id, r.status::text as status, r.requested_model, r.resolved_model,
             r.classifier_kind, r.prompt_version, r.prompt_hash, r.started_at, r.completed_at,
             v.version_label as taxonomy_version_label,
             count(c.id)::int as queued,
             count(c.id) filter (where c.status = 'SUCCEEDED')::int as succeeded,
             count(c.id) filter (where c.status = 'FAILED')::int as failed
        from app.classification_run r
        join app.taxonomy_version v on v.tenant_id = r.tenant_id and v.id = r.taxonomy_version_id
        left join app.ai_classification c on c.tenant_id = r.tenant_id and c.run_id = r.id
       where r.tenant_id = ${ctx.tenantId} and r.project_id = ${ctx.projectId}
       group by r.id, r.status, r.requested_model, r.resolved_model, r.classifier_kind,
                r.prompt_version, r.prompt_hash, r.started_at, r.completed_at, v.version_label
       order by r.created_at desc
    `);
    return (
      rows.rows as Array<{
        id: string;
        status: string;
        requested_model: string;
        resolved_model: string | null;
        classifier_kind: string;
        prompt_version: string;
        prompt_hash: string;
        taxonomy_version_label: string;
        started_at: string | Date | null;
        completed_at: string | Date | null;
        queued: number;
        succeeded: number;
        failed: number;
      }>
    ).map((row) => ({
      runId: row.id,
      status: row.status,
      requestedModel: row.requested_model,
      resolvedModel: row.resolved_model,
      classifierKind: row.classifier_kind,
      promptVersion: row.prompt_version,
      promptHash: row.prompt_hash,
      taxonomyVersionLabel: row.taxonomy_version_label,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      queued: Number(row.queued),
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
    }));
  });
}
