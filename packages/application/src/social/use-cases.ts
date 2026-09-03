import { socialSchema, type Database, type DbTx } from "@eia/db";
import {
  assertAiProcessingAllowed,
  assertReviewSelectable,
  compareLabels,
  decideReview,
  isEligibleForClassification,
  NotFound,
  requireAvailableClassifier,
  requireCapability,
  requirePermission,
  type ClassifierAvailability,
  type ProvenanceFacets,
  type RequestContext,
  type TaxonomyDefinition,
} from "@eia/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { recordAudit } from "../audit/record";
import { withFieldContext } from "../field/context";
import { PROMPT_VERSION, promptHash } from "./prompt";
import { loadTaxonomyDefinition } from "./read-models";

/**
 * Social Intelligence mutations: starting a classification run, and settling a coding.
 *
 * Two rules govern everything here.
 *
 * **A run is created, not executed, by a request.** Starting a run writes one `classification_run`
 * and one `PENDING` `ai_classification` per eligible answer, inside one transaction, and returns.
 * No model is called on the request path: an HTTP request that waits on a provider is a request
 * that times out halfway through, leaving a run whose state nobody can reconstruct. The worker
 * does the calling.
 *
 * **The privacy gate is checked per answer, against provenance.** Not once for the project, not on
 * the user's role: every answer whose text would leave this system is checked for
 * `DEMO_SIMULATION`, and a run that would include anything else is refused before a single row is
 * written. The test asserts the classifier was never constructed, let alone invoked.
 */
export const startRunInputSchema = z
  .object({
    taxonomyVersionId: z.uuid(),
    surveyVersionId: z.uuid(),
    questionId: z.uuid(),
  })
  .strict();
export type StartRunInput = z.infer<typeof startRunInputSchema>;

export interface StartedRun {
  readonly runId: string;
  readonly queued: number;
  readonly skipped: number;
}

export interface ClassificationRunConfig {
  /**
   * The resolved classifier for this environment (IG4-001), which carries the model the run will
   * ask for and the adapter that will answer. Passing the availability rather than a bare model
   * name is what makes the refusal unavoidable: there is no shape of this argument that names a
   * model without also saying whether anything can run it.
   */
  readonly classifier: ClassifierAvailability;
}

/**
 * Create a run and queue its work.
 *
 * Eligibility, in one place (`isEligibleForClassification`): submitted responses only, the
 * configured question only, non-empty text only. Everything else is counted as skipped and
 * reported, rather than silently dropped.
 */
export async function startClassificationRun(
  db: Database,
  ctx: RequestContext,
  input: StartRunInput,
  config: ClassificationRunConfig,
): Promise<StartedRun> {
  requireCapability(ctx, "social.ai_coding");
  requirePermission(ctx, "social.ai.run");
  // Before anything else, including before reading a single answer: a run nothing can process is
  // worse than no run, because the queue would show work that never moves (IG4-001).
  const classifier = requireAvailableClassifier(config.classifier);
  // Reading the responses is a precondition for coding them: a caller who may not read an
  // individual answer may not send it to a model either.
  requirePermission(ctx, "field.responses.read");
  const parsed = startRunInputSchema.parse(input);
  const projectId = requireProject(ctx);

  return withFieldContext(db, ctx, async (tx) => {
    const taxonomy = await loadTaxonomyDefinition(tx, ctx, parsed.taxonomyVersionId);

    const candidates = await tx.execute(sql`
      select a.id            as answer_id,
             a.question_id   as question_id,
             a.text_value    as text,
             i.status::text  as instance_status,
             p.regime::text  as regime,
             p.origin::text  as origin,
             p.transformations as transformations,
             p.granularity::text as granularity
        from app.survey_answer a
        join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
        join app.provenance_record p on p.tenant_id = i.tenant_id and p.id = i.provenance_id
       where a.tenant_id = ${ctx.tenantId}
         and a.project_id = ${projectId}
         and a.question_id = ${parsed.questionId}
         and i.survey_version_id = ${parsed.surveyVersionId}
       order by a.id
    `);

    const rows = candidates.rows as Array<{
      answer_id: string;
      question_id: string;
      text: string | null;
      instance_status: string;
      regime: string;
      origin: string;
      transformations: string[];
      granularity: string | null;
    }>;

    const eligible = rows.filter((row) =>
      isEligibleForClassification(
        {
          answerId: row.answer_id,
          instanceStatus: row.instance_status,
          questionId: row.question_id,
          text: row.text,
        },
        parsed.questionId,
      ),
    );

    // The gate, before anything is written. One non-demo answer refuses the whole run: a partial
    // run that quietly excluded the real data would be a worse outcome than a clear refusal.
    for (const row of eligible) {
      assertAiProcessingAllowed({
        regime: row.regime,
        origin: row.origin,
        transformations: row.transformations,
        granularity: row.granularity,
      } as ProvenanceFacets);
    }

    if (eligible.length === 0) {
      throw new NotFound("no eligible open responses: nothing submitted, or nothing with text");
    }

    const runProvenance = await createSocialProvenance(tx, ctx, projectId, {
      title: "Propuesta de codificación asistida",
      note:
        "Propuesta automática, provisional y sin validar. No es una conclusión del estudio: un " +
        "especialista la revisa y decide. Se produjo sobre respuestas sintéticas de demostración.",
      method: `Clasificación automática · ${classifier.model} · prompt ${PROMPT_VERSION}`,
      // The proposal is explicitly *not* validated; that is the whole distinction this slice draws.
      validationState: "PENDING",
    });

    const runId = randomUUID();
    await tx.insert(socialSchema.classificationRun).values({
      id: runId,
      tenantId: ctx.tenantId,
      projectId,
      taxonomyVersionId: parsed.taxonomyVersionId,
      sourceSurveyVersionId: parsed.surveyVersionId,
      sourceQuestionId: parsed.questionId,
      requestedModel: classifier.model,
      classifierKind: classifier.kind,
      promptVersion: PROMPT_VERSION,
      promptHash: promptHash(taxonomy),
      status: "PENDING",
      initiatedByUserId: ctx.userId,
      provenanceId: runProvenance,
    });

    for (const row of eligible) {
      await tx.insert(socialSchema.aiClassification).values({
        id: randomUUID(),
        tenantId: ctx.tenantId,
        projectId,
        runId,
        answerId: row.answer_id,
        status: "PENDING",
        provenanceId: runProvenance,
      });
    }

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "social.classification_run.started",
        objectKind: "classification_run",
        objectId: runId,
        details: {
          queued: eligible.length,
          skipped: rows.length - eligible.length,
          model: classifier.model,
          classifier: classifier.kind,
          taxonomyVersion: taxonomy.versionLabel,
          promptVersion: PROMPT_VERSION,
        },
      },
    );

    return { runId, queued: eligible.length, skipped: rows.length - eligible.length };
  });
}

export const submitReviewInputSchema = z
  .object({
    classificationId: z.uuid(),
    /** The specialist's final categories, by code. The decision is derived, never sent. */
    categoryCodes: z.array(z.string()).min(1).max(8),
    reviewStartedAt: z.iso.datetime().nullable().optional(),
  })
  .strict();
export type SubmitReviewInput = z.infer<typeof submitReviewInputSchema>;

export interface ReviewResult {
  readonly reviewId: string;
  readonly decision: "ACCEPTED" | "CORRECTED";
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

/**
 * Settle one coding.
 *
 * What this deliberately does not do: touch the classification. The proposal stays exactly as the
 * model produced it, including when the specialist replaces every label — otherwise the pair
 * "what was proposed / what was decided" would collapse into one value and nothing could later be
 * said about either.
 *
 * The decision is computed from the two label sets, not accepted from the client, because a
 * correction recorded as an acceptance is precisely the number an evaluation would depend on.
 */
export async function submitHumanReview(
  db: Database,
  ctx: RequestContext,
  input: SubmitReviewInput,
): Promise<ReviewResult> {
  requireCapability(ctx, "social.ai_coding");
  requirePermission(ctx, "social.coding.review");
  requirePermission(ctx, "field.responses.read");
  const parsed = submitReviewInputSchema.parse(input);
  const projectId = requireProject(ctx);

  return withFieldContext(db, ctx, async (tx) => {
    const found = await tx.execute(sql`
      select c.id, c.answer_id, c.status::text as status, r.taxonomy_version_id
        from app.ai_classification c
        join app.classification_run r on r.tenant_id = c.tenant_id and r.id = c.run_id
       where c.tenant_id = ${ctx.tenantId} and c.id = ${parsed.classificationId}
    `);
    const classification = found.rows[0] as
      { id: string; answer_id: string; status: string; taxonomy_version_id: string } | undefined;
    if (!classification) throw new NotFound("classification not found");
    if (classification.status !== "SUCCEEDED") {
      throw new NotFound("only a succeeded proposal can be reviewed");
    }

    const taxonomy = await loadTaxonomyDefinition(tx, ctx, classification.taxonomy_version_id);
    assertReviewSelectable(taxonomy, parsed.categoryCodes);

    const proposed = await tx.execute(sql`
      select cat.code from app.ai_classification_category link
        join app.taxonomy_category cat
          on cat.tenant_id = link.tenant_id and cat.id = link.category_id
       where link.tenant_id = ${ctx.tenantId} and link.classification_id = ${classification.id}
    `);
    const proposedCodes = (proposed.rows as Array<{ code: string }>).map((row) => row.code);

    const decision = decideReview(proposedCodes, parsed.categoryCodes);
    const comparison = compareLabels(proposedCodes, parsed.categoryCodes);

    const membership = await tx.execute(sql`
      select pm.id from app.project_membership pm
        join app.tenant_membership tm on tm.id = pm.tenant_membership_id
       where pm.tenant_id = ${ctx.tenantId} and pm.project_id = ${projectId}
         and tm.user_id = ${ctx.userId}
       limit 1
    `);
    const membershipId = (membership.rows[0] as { id: string } | undefined)?.id;
    if (!membershipId) throw new NotFound("no project membership for this reviewer");

    const reviewProvenance = await createSocialProvenance(tx, ctx, projectId, {
      title: "Codificación validada por especialista",
      note:
        "Codificación decidida por una persona a partir de una propuesta automática. Es el " +
        "resultado que las métricas validadas cuentan.",
      method: `Revisión humana de una propuesta automática · decisión ${decision}`,
      validationState: "VALIDATED",
    });

    const reviewId = randomUUID();
    await tx.insert(socialSchema.humanReview).values({
      id: reviewId,
      tenantId: ctx.tenantId,
      projectId,
      classificationId: classification.id,
      answerId: classification.answer_id,
      taxonomyVersionId: classification.taxonomy_version_id,
      reviewerUserId: ctx.userId,
      reviewerMembershipId: membershipId,
      decision,
      reviewStartedAt: parsed.reviewStartedAt ? new Date(parsed.reviewStartedAt) : null,
      provenanceId: reviewProvenance,
    });

    const categoryIds = await tx.execute(sql`
      select id, code from app.taxonomy_category
       where tenant_id = ${ctx.tenantId} and version_id = ${classification.taxonomy_version_id}
         and code in (${sql.join(
           parsed.categoryCodes.map((code) => sql`${code}`),
           sql`, `,
         )})
    `);
    for (const row of categoryIds.rows as Array<{ id: string; code: string }>) {
      await tx.insert(socialSchema.humanReviewCategory).values({
        id: randomUUID(),
        tenantId: ctx.tenantId,
        projectId,
        reviewId,
        categoryId: row.id,
      });
    }

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "social.coding.reviewed",
        objectKind: "human_review",
        objectId: reviewId,
        details: {
          decision,
          // Category codes are scheme vocabulary, not anyone's words: safe to audit.
          proposed: proposedCodes.length,
          final: parsed.categoryCodes.length,
          added: comparison.added.length,
          removed: comparison.removed.length,
        },
      },
    );

    return {
      reviewId,
      decision,
      added: comparison.added,
      removed: comparison.removed,
    };
  });
}

/** Provenance for a derived social artefact: demo regime, system origin, derived, individual. */
async function createSocialProvenance(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  input: { title: string; note: string; method: string; validationState: string },
): Promise<string> {
  const id = randomUUID();
  await tx.execute(sql`
    insert into app.provenance_record
      (id, tenant_id, project_id, regime, origin, transformations, granularity, title, note,
       method, validation_state, captured_at)
    values (${id}, ${ctx.tenantId}, ${projectId}, 'DEMO_SIMULATION', 'SYSTEM_GENERATED',
            ARRAY['DERIVED']::app.provenance_transformation[], 'INDIVIDUAL', ${input.title},
            ${input.note}, ${input.method}, ${input.validationState}, now())
  `);
  return id;
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}

/** Re-exported so the worker and the web layer agree on the queue's shape. */
export type { TaxonomyDefinition };

export const socialCategoryIdsFor = async (
  tx: DbTx,
  tenantId: string,
  versionId: string,
  codes: ReadonlyArray<string>,
): Promise<ReadonlyArray<{ id: string; code: string }>> => {
  if (codes.length === 0) return [];
  const rows = await tx
    .select({
      id: socialSchema.taxonomyCategory.id,
      code: socialSchema.taxonomyCategory.code,
    })
    .from(socialSchema.taxonomyCategory)
    .where(
      and(
        eq(socialSchema.taxonomyCategory.tenantId, tenantId),
        eq(socialSchema.taxonomyCategory.versionId, versionId),
        inArray(socialSchema.taxonomyCategory.code, [...codes]),
      ),
    );
  return rows;
};
