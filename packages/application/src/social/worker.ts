import { socialSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  assertAiProcessingAllowed,
  ClassifierUnavailable,
  MAX_CLASSIFICATION_ATTEMPTS,
  shouldRetry,
  type ClassificationInput,
  type OpenTextClassifier,
  type ProvenanceFacets,
} from "@eia/domain";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { PROMPT_VERSION } from "./prompt";

/**
 * How a background process does authorised work without becoming a superuser.
 *
 * The worker has no session and no membership; it is a process. Every Social policy needs a
 * tenant, a project and a member, so the worker cannot simply select a queue. Nor may it hold
 * `BYPASSRLS` — that would trade one tenancy guarantee for a scheduling convenience.
 *
 * The shape used here has three steps.
 *
 * 1. **Claim.** `app.claim_classification` (SECURITY DEFINER, migration 0017) takes exactly one
 *    pending row with `FOR UPDATE SKIP LOCKED` and returns four identifiers: the classification,
 *    its tenant, its project and the user who started the run. No answer text, no categories, no
 *    other tenant's rows — the privileged surface is as small as "there is work, here is whose".
 *
 * 2. **Work under that user's context.** Everything after the claim runs in an ordinary RLS
 *    transaction with `app.user_id` set to the initiator, so the policies apply exactly as they
 *    would to their request. If their project access was revoked between starting the run and the
 *    worker reaching it, the transaction sees nothing and the job fails — which is the correct
 *    outcome, not an error to work around.
 *
 * 3. **Check the data again.** The privacy gate is re-asserted here, on the answer the worker is
 *    about to send, because the run was authorised minutes ago and this is the moment the text
 *    actually leaves the system.
 */
export interface ClaimedClassification {
  readonly classificationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly initiatedByUserId: string;
}

export async function claimNextClassification(db: Database): Promise<ClaimedClassification | null> {
  // The claim itself runs without a request context: the function is SECURITY DEFINER precisely
  // because there is no user to speak for yet. It returns identifiers, never content.
  const result = await db.execute(
    sql`select * from app.claim_classification(${MAX_CLASSIFICATION_ATTEMPTS}::integer)`,
  );
  const row = result.rows[0] as
    | {
        classification_id: string;
        tenant_id: string;
        project_id: string;
        initiated_by_user_id: string;
      }
    | undefined;
  if (!row) return null;
  return {
    classificationId: row.classification_id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    initiatedByUserId: row.initiated_by_user_id,
  };
}

/** Return claims that were never completed — a crashed worker — to the queue. Bounded recovery. */
export async function releaseStaleClaims(db: Database, staleAfter = "10 minutes"): Promise<number> {
  const result = await db.execute(
    sql`select app.release_stale_classifications(${staleAfter}::interval) as released`,
  );
  return Number((result.rows[0] as { released: number }).released);
}

export interface ProcessOutcome {
  readonly classificationId: string;
  readonly status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  readonly reason?: string;
}

/**
 * Process one claimed classification: read the answer, call the model, store the proposal.
 *
 * The whole body runs inside the initiator's RLS context. A failure is recorded as a failure —
 * with its attempt count, so the queue can retry a transient one and stop retrying a permanent
 * one — and never as a fabricated classification.
 */
export async function processClassification(
  db: Database,
  claim: ClaimedClassification,
  classifier: OpenTextClassifier,
): Promise<ProcessOutcome> {
  return withDbContext(
    db,
    {
      userId: claim.initiatedByUserId,
      tenantId: claim.tenantId,
      projectId: claim.projectId,
      surface: "job",
      // The initiator held `field.responses.read` when the run was authorised; the worker acts as
      // them, and the transaction still refuses everything their membership does not allow.
      fieldResponsesAccess: true,
    },
    async (tx) => {
      const loaded = await tx.execute(sql`
        select c.id, c.attempts, c.answer_id,
               a.text_value as text,
               r.id as run_id, r.requested_model, r.taxonomy_version_id, r.classifier_kind,
               p.regime::text as regime, p.origin::text as origin,
               p.transformations as transformations, p.granularity::text as granularity
          from app.ai_classification c
          join app.classification_run r on r.tenant_id = c.tenant_id and r.id = c.run_id
          join app.survey_answer a on a.tenant_id = c.tenant_id and a.id = c.answer_id
          join app.survey_instance i on i.tenant_id = a.tenant_id and i.id = a.instance_id
          join app.provenance_record p on p.tenant_id = i.tenant_id and p.id = i.provenance_id
         where c.tenant_id = ${claim.tenantId} and c.id = ${claim.classificationId}
      `);
      const row = loaded.rows[0] as
        | {
            id: string;
            attempts: number;
            answer_id: string;
            text: string | null;
            run_id: string;
            requested_model: string;
            taxonomy_version_id: string;
            classifier_kind: string;
            regime: string;
            origin: string;
            transformations: string[];
            granularity: string | null;
          }
        | undefined;

      if (!row) {
        // Invisible under the initiator's context: their access is gone, or the row is another
        // tenant's. Either way this worker does not process it.
        return {
          classificationId: claim.classificationId,
          status: "SKIPPED",
          reason: "not visible under the initiating user's context",
        };
      }

      try {
        // The gate again, at the moment the text would leave.
        assertAiProcessingAllowed({
          regime: row.regime,
          origin: row.origin,
          transformations: row.transformations,
          granularity: row.granularity,
        } as ProvenanceFacets);

        if (row.classifier_kind !== classifier.kind) {
          throw new ClassifierUnavailable(
            `this run was created for the ${row.classifier_kind} classifier but this worker has ` +
              `${classifier.kind}; a run does not change classifier halfway through`,
            false,
          );
        }

        const taxonomy = await loadDefinition(tx, claim.tenantId, row.taxonomy_version_id);
        const input: ClassificationInput = { text: row.text ?? "", taxonomy };

        const result = await classifier.classify(input, {
          model: row.requested_model,
          promptVersion: PROMPT_VERSION,
        });

        await tx.execute(sql`
          update app.ai_classification
             set status = 'SUCCEEDED',
                 confidence = ${result.output.confidence},
                 needs_review = ${result.output.needsReview},
                 model_id = ${result.modelId},
                 provider = ${result.provider},
                 input_tokens = ${result.inputTokens},
                 output_tokens = ${result.outputTokens},
                 total_tokens = ${result.totalTokens},
                 latency_ms = ${result.latencyMs},
                 processed_at = now(),
                 error = null
           where tenant_id = ${claim.tenantId} and id = ${row.id}
        `);

        const categories = await tx.execute(sql`
          select id, code from app.taxonomy_category
           where tenant_id = ${claim.tenantId} and version_id = ${row.taxonomy_version_id}
             and code in (${sql.join(
               result.output.categories.map((code) => sql`${code}`),
               sql`, `,
             )})
        `);
        for (const category of categories.rows as Array<{ id: string; code: string }>) {
          await tx.insert(socialSchema.aiClassificationCategory).values({
            id: randomUUID(),
            tenantId: claim.tenantId,
            projectId: claim.projectId,
            classificationId: row.id,
            categoryId: category.id,
          });
        }

        // The run's resolved model is written once, from the first classification that reports
        // one: it is a property of the run's configuration, not of each call.
        await tx.execute(sql`
          update app.classification_run
             set status = 'RUNNING',
                 started_at = coalesce(started_at, now()),
                 resolved_model = coalesce(resolved_model, ${result.modelId}),
                 provider = coalesce(provider, ${result.provider})
           where tenant_id = ${claim.tenantId} and id = ${row.run_id}
        `);
        await completeRunIfDone(tx, claim.tenantId, row.run_id);

        return { classificationId: row.id, status: "SUCCEEDED" };
      } catch (error) {
        const message = (error as Error).message;
        const retryable = error instanceof ClassifierUnavailable ? error.retryable : false;
        const attempts = row.attempts;
        const willRetry = retryable && shouldRetry(attempts);

        await tx.execute(sql`
          update app.ai_classification
             set status = ${willRetry ? "PENDING" : "FAILED"},
                 claimed_at = null,
                 processed_at = ${willRetry ? null : sql`now()`},
                 error = ${truncate(message)}
           where tenant_id = ${claim.tenantId} and id = ${row.id}
        `);
        if (!willRetry) await completeRunIfDone(tx, claim.tenantId, row.run_id);

        return {
          classificationId: row.id,
          status: willRetry ? "SKIPPED" : "FAILED",
          reason: message,
        };
      }
    },
  );
}

/** A run is complete when nothing of it is pending or processing any more. */
async function completeRunIfDone(tx: DbTx, tenantId: string, runId: string): Promise<void> {
  await tx.execute(sql`
    update app.classification_run r
       set status = case
                      when exists (select 1 from app.ai_classification c
                                    where c.tenant_id = r.tenant_id and c.run_id = r.id
                                      and c.status = 'FAILED')
                        and not exists (select 1 from app.ai_classification c
                                         where c.tenant_id = r.tenant_id and c.run_id = r.id
                                           and c.status = 'SUCCEEDED')
                      then 'FAILED'::app.classification_run_status
                      else 'COMPLETED'::app.classification_run_status
                    end,
           completed_at = now()
     where r.tenant_id = ${tenantId} and r.id = ${runId}
       and not exists (select 1 from app.ai_classification c
                        where c.tenant_id = r.tenant_id and c.run_id = r.id
                          and c.status in ('PENDING', 'PROCESSING'))
  `);
}

async function loadDefinition(tx: DbTx, tenantId: string, versionId: string) {
  const versionRow = await tx.execute(sql`
    select id, version_label from app.taxonomy_version
     where tenant_id = ${tenantId} and id = ${versionId}
  `);
  const version = versionRow.rows[0] as { id: string; version_label: string } | undefined;
  if (!version) throw new ClassifierUnavailable("the run's taxonomy version is gone", false);

  const categories = await tx.execute(sql`
    select code, label, description, ordinal from app.taxonomy_category
     where tenant_id = ${tenantId} and version_id = ${versionId}
     order by ordinal
  `);
  return {
    versionId: version.id,
    versionLabel: version.version_label,
    categories: (
      categories.rows as Array<{
        code: string;
        label: string;
        description: string;
        ordinal: number;
      }>
    ).map((row) => ({ ...row, ordinal: Number(row.ordinal) })),
  };
}

/** Error text is operational detail, not an answer: bounded, and never the response body. */
function truncate(message: string): string {
  return message.length > 500 ? `${message.slice(0, 497)}…` : message;
}
