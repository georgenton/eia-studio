import { randomUUID } from "node:crypto";

import { documentsSchema, reviewSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  assertReviewableCorpus,
  assertRunTransition,
  citationFor,
  ClassifierUnavailable,
  decideCandidate,
  DOCUMENT_REVIEW_PROMPT_VERSION,
  groundCandidate,
  InvalidInput,
  lensRef,
  NotFound,
  renderCitation,
  requireAvailableClassifier,
  blockedSources,
  requireCapability,
  requirePermission,
  documentReviewDecisionSchema,
  reviewOutputSchema,
  lensFor,
  type ClassifierAvailability,
  type DocumentReviewer,
  type GroundedCandidate,
  type RequestContext,
  type RetrievedPassage,
  type ReviewCandidateState,
  type DocumentReviewDecisionSubmission,
  type ReviewEmptyReason,
  type ReviewLensKey,
  type ReviewSupportKind,
} from "@eia/domain";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { recordAudit } from "../audit/record";
import { FullTextRetriever } from "./retriever";

/**
 * AI document review, end to end (ADR-035).
 *
 * > **Rules calculate. AI proposes. A human validates. The system preserves all three.**
 *
 * The order of operations is the design, and it is deliberately retrieval-first:
 *
 * 1. a person picks a **lens** and a **corpus** — versions of this project's documents;
 * 2. the **privacy gate** runs, and refuses the whole run if any selected version is not
 *    `NO_PERSONAL_DATA_KNOWN`, naming every document that blocked it;
 * 3. the run is written `QUEUED`, with the corpus recorded as rows and the adapter and model
 *    recorded as text — so what answered is legible a year later;
 * 4. the worker claims it, **retrieves** the lens's passages from that corpus with the same
 *    full-text retriever the assistant uses, and only then calls a model;
 * 5. every candidate the model returns is **grounded** against the passages that were actually
 *    retrieved, and one that cannot be is refused and counted, never quietly dropped;
 * 6. a specialist accepts or dismisses, with a mandatory justification, and both the model's words
 *    and the person's decision are kept for ever.
 *
 * **No passage, no claim.** If retrieval finds nothing, the model is never called and the run
 * completes saying so. That is a result, not a failure, and the surface distinguishes it from
 * "the model found nothing to suggest".
 */

/** How many passages one lens hands a model. Bounded: a prompt is not a corpus. */
export const REVIEW_PASSAGE_LIMIT = 12;
/** Per probe, before the lens's probes are merged and de-duplicated. */
const PER_PROBE_LIMIT = 5;

export interface StartReviewInput {
  readonly lens: ReviewLensKey;
  /**
   * Which documents to read. Absent means *the whole readable corpus* — every document whose
   * current version is `READY` — which is what a specialist asking "check this study" means.
   */
  readonly documentIds?: ReadonlyArray<string>;
}

export interface StartedReviewRun {
  readonly runId: string;
  readonly lens: ReviewLensKey;
  readonly sourceCount: number;
}

/**
 * Ask for a review.
 *
 * Nothing is written unless a reviewer is actually available (`requireAvailableClassifier`, the
 * rule IG4-001 established): a `QUEUED` run no worker could ever process shows a specialist work
 * that will not move, and the only way to find out would be to read the worker's logs.
 */
export async function startDocumentReviewRun(
  db: Database,
  ctx: RequestContext,
  availability: ClassifierAvailability,
  input: StartReviewInput,
): Promise<StartedReviewRun> {
  requireCapability(ctx, "core.documents");
  requireCapability(ctx, "quality.rag_assistant");
  requirePermission(ctx, "quality.write");
  const projectId = requireProject(ctx);
  // Validates the lens key before anything is written: a run naming a lens nobody declared would
  // be a run no worker could classify.
  lensFor(input.lens);
  const reviewer = requireAvailableClassifier(availability);

  const sources = await withDbContext(db, ctx, (tx) =>
    readableCorpus(tx, projectId, input.documentIds),
  );

  const blocked = blockedSources(sources);
  if (sources.length === 0 || blocked.length > 0) {
    if (blocked.length > 0) {
      /*
       * A refusal is a decision the product made about somebody's data, and one that left no
       * trace would be indistinguishable from a run nobody attempted.
       *
       * It is written in its **own** transaction, before the refusal is thrown. Auditing inside
       * the transaction that then throws would roll the line back with it — the audit would exist
       * only for refusals that did not happen.
       */
      await withDbContext(db, ctx, (tx) =>
        recordAudit(
          tx,
          { tenantId: ctx.tenantId, projectId },
          { userId: ctx.userId, kind: "user", requestId: ctx.requestId ?? null },
          {
            action: "documents.review.run_refused",
            objectKind: "project",
            objectId: projectId,
            // Flat scalars, as every audit line is. Document *codes* — `DOC-002` — never
            // filenames: a delivered study can be named after a person (ADR-031 §1).
            details: {
              lens: input.lens,
              blockedCount: blocked.length,
              blockedDocuments: blocked.map((item) => item.documentCode).join(", "),
              blockedReasons: [...new Set(blocked.map((item) => item.reason))].join(", "),
            },
          },
        ),
      );
    }
    // Throws `ReviewCorpusRefused` naming every blocking document, or `InvalidInput` for an empty
    // corpus. The domain owns both messages.
    assertReviewableCorpus(sources);
  }

  return withDbContext(db, ctx, async (tx) => {
    const runId = randomUUID();
    const provenanceId = await createReviewProvenance(tx, ctx, projectId, {
      title: `Revisión asistida · ${input.lens}`,
      note:
        `Candidatos propuestos por un modelo sobre ${sources.length} versión(es) de documentos ` +
        "del proyecto. Requiere validación de un especialista.",
      method: `${DOCUMENT_REVIEW_PROMPT_VERSION} · ${lensRef(input.lens)} · ${reviewer.model}`,
    });

    await tx.insert(reviewSchema.documentReviewRun).values({
      id: runId,
      tenantId: ctx.tenantId,
      projectId,
      lens: input.lens,
      lensRef: lensRef(input.lens),
      status: "QUEUED",
      adapterKind: reviewer.kind,
      requestedModel: reviewer.model,
      promptVersion: DOCUMENT_REVIEW_PROMPT_VERSION,
      initiatedByUserId: ctx.userId,
      provenanceId,
    });

    await tx.insert(reviewSchema.documentReviewSource).values(
      sources.map((source) => ({
        id: randomUUID(),
        tenantId: ctx.tenantId,
        projectId,
        runId,
        documentId: source.documentId,
        documentVersionId: source.documentVersionId,
        privacyClassificationAtRun: source.privacyClassification,
      })),
    );

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId ?? null },
      {
        action: "documents.review.run_started",
        objectKind: "document_review_run",
        objectId: runId,
        // The lens, the size of the corpus, what will answer, and whether text will leave this
        // system. Never a passage, never a filename, never a document's words.
        details: {
          lens: input.lens,
          lensRef: lensRef(input.lens),
          sources: sources.length,
          adapter: reviewer.kind,
          model: reviewer.model,
          live: reviewer.live,
        },
      },
    );

    // `lens` is not narrowed by the insert, so it is restated from the validated input.
    return { runId, lens: input.lens, sourceCount: sources.length };
  });
}

interface CorpusRow {
  readonly documentId: string;
  readonly documentCode: string;
  readonly documentVersionId: string;
  readonly privacyClassification: string;
  readonly containsPii: boolean;
  readonly processingState: string;
}

/**
 * The project's corpus, as versions.
 *
 * Only **current** versions: a review says something about the study as it now stands, and reading
 * a superseded file would produce candidates about words a corrected delivery already replaced.
 * Superseded versions stay readable so old citations resolve — that is ADR-031's rule and it is
 * unchanged.
 */
async function readableCorpus(
  tx: DbTx,
  projectId: string,
  documentIds: ReadonlyArray<string> | undefined,
): Promise<ReadonlyArray<CorpusRow>> {
  const rows = await tx
    .select({
      documentId: documentsSchema.sourceDocument.id,
      documentCode: documentsSchema.sourceDocument.code,
      documentVersionId: documentsSchema.documentVersion.id,
      privacyClassification: documentsSchema.documentVersion.privacyClassification,
      containsPii: documentsSchema.sourceDocument.containsPii,
      processingState: documentsSchema.documentVersion.processingState,
    })
    .from(documentsSchema.sourceDocument)
    .innerJoin(
      documentsSchema.documentVersion,
      eq(documentsSchema.documentVersion.id, documentsSchema.sourceDocument.currentVersionId),
    )
    .where(eq(documentsSchema.sourceDocument.projectId, projectId))
    .orderBy(asc(documentsSchema.sourceDocument.code));

  if (!documentIds) {
    // The whole corpus: a document that is not readable yet is not a refusal, it simply is not
    // part of what can be reviewed. A selection naming one *is* refused, below, because somebody
    // asked for it specifically and would otherwise be told nothing.
    return rows.filter((row) => row.processingState === "READY");
  }

  const wanted = new Set(documentIds);
  const selected = rows.filter((row) => wanted.has(row.documentId));
  if (selected.length !== wanted.size) {
    throw new NotFound("one of the selected documents has no current version in this project");
  }
  return selected;
}

/* ---------------------------------------------------------------------------------------------
 * The queue
 * ------------------------------------------------------------------------------------------ */

export interface ReviewClaim {
  readonly runId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly initiatedByUserId: string;
}

export async function claimNextDocumentReview(
  db: Database,
  maxAttempts = 3,
): Promise<ReviewClaim | null> {
  const result = await db.execute(
    sql`select * from app.claim_document_review(${maxAttempts}::integer)`,
  );
  const row = result.rows[0] as
    | { run_id: string; tenant_id: string; project_id: string; initiated_by_user_id: string }
    | undefined;
  if (!row) return null;
  return {
    runId: row.run_id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    initiatedByUserId: row.initiated_by_user_id,
  };
}

export async function releaseStaleDocumentReviews(
  db: Database,
  staleAfter = "15 minutes",
): Promise<number> {
  const result = await db.execute(
    sql`select app.release_stale_document_reviews(${staleAfter}::interval) as released`,
  );
  return Number((result.rows[0] as { released: number } | undefined)?.released ?? 0);
}

export interface ReviewOutcome {
  readonly runId: string;
  readonly status: "COMPLETED" | "FAILED";
  readonly passageCount: number;
  readonly candidatesCreated: number;
  readonly candidatesRefused: number;
  readonly emptyReason: ReviewEmptyReason | null;
  /** Operator-facing and bounded. Never a passage, never the model's response body. */
  readonly note: string | null;
}

/**
 * Process one claimed run.
 *
 * The context is the initiator's, in the shape `processClassification` and
 * `processDocumentExtraction` established: the worker holds no identity of its own, opens an
 * ordinary RLS transaction *as them*, and therefore needs no `BYPASSRLS`. If their project access
 * was revoked between the claim and here, the transaction sees nothing and the job fails safely.
 */
export async function processDocumentReview(
  db: Database,
  claim: ReviewClaim,
  reviewer: DocumentReviewer,
  model: string,
): Promise<ReviewOutcome> {
  const ctx = {
    userId: claim.initiatedByUserId,
    tenantId: claim.tenantId,
    projectId: claim.projectId,
    surface: "job" as const,
  };

  const loaded = await withDbContext(db, ctx, async (tx) => {
    const [run] = await tx
      .select({
        id: reviewSchema.documentReviewRun.id,
        lens: reviewSchema.documentReviewRun.lens,
        status: reviewSchema.documentReviewRun.status,
        provenanceId: reviewSchema.documentReviewRun.provenanceId,
      })
      .from(reviewSchema.documentReviewRun)
      .where(eq(reviewSchema.documentReviewRun.id, claim.runId));
    if (!run) return null;

    const sources = await tx
      .select({ versionId: reviewSchema.documentReviewSource.documentVersionId })
      .from(reviewSchema.documentReviewSource)
      .where(eq(reviewSchema.documentReviewSource.runId, claim.runId));

    const passages = await retrieveForLens(
      tx,
      { tenantId: claim.tenantId, projectId: claim.projectId },
      run.lens,
      sources.map((source) => source.versionId),
    );
    return { run, passages };
  });

  // The claim moved it to PROCESSING; an invisible row means the initiator's access is gone.
  if (!loaded) throw new NotFound("document review run");
  const { run, passages } = loaded;

  if (passages.length === 0) {
    // **No passage, no claim.** The model is never called: there is nothing for it to read, and
    // asking it anyway would invite it to write from its own knowledge of road studies.
    return settle(db, ctx, claim.runId, {
      status: "COMPLETED",
      passageCount: 0,
      candidatesCreated: 0,
      candidatesRefused: 0,
      emptyReason: "NO_PASSAGES",
      note: null,
    });
  }

  let raw;
  try {
    raw = await reviewer.review({ lens: run.lens, passages, model });
  } catch (error) {
    const message = error instanceof ClassifierUnavailable ? error.message : "the reviewer failed";
    return settle(db, ctx, claim.runId, {
      status: "FAILED",
      passageCount: passages.length,
      candidatesCreated: 0,
      candidatesRefused: 0,
      emptyReason: null,
      note: message.slice(0, 500),
    });
  }

  const parsed = reviewOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return settle(db, ctx, claim.runId, {
      status: "FAILED",
      passageCount: passages.length,
      candidatesCreated: 0,
      candidatesRefused: 0,
      emptyReason: null,
      note: "the reviewer returned something the output schema refuses",
    });
  }

  const grounded: GroundedCandidate[] = [];
  let refused = 0;
  for (const candidate of parsed.data.candidates) {
    try {
      grounded.push(groundCandidate(candidate, passages));
    } catch {
      // One bad candidate does not cost a specialist the good ones. The count is stored and shown.
      refused += 1;
    }
  }

  return withDbContext(db, ctx, async (tx) => {
    const created = await writeCandidates(tx, ctx, claim, run.lens, grounded);
    await advanceRun(tx, claim.runId, "COMPLETED", {
      passageCount: passages.length,
      candidatesCreated: created,
      candidatesRefused: refused,
    });
    return {
      runId: claim.runId,
      status: "COMPLETED" as const,
      passageCount: passages.length,
      candidatesCreated: created,
      candidatesRefused: refused,
      emptyReason: created === 0 ? ("NO_CANDIDATES" as const) : null,
      note: null,
    };
  });
}

/**
 * The lens's passages: every probe, merged and de-duplicated, highest-ranked first.
 *
 * The probes run whether or not a model is available — this is ordinary full-text retrieval over
 * the project's own chunks (ADR-021), bounded to the versions the run declared.
 */
async function retrieveForLens(
  tx: DbTx,
  scope: { tenantId: string; projectId: string },
  lens: ReviewLensKey,
  versionIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<RetrievedPassage>> {
  if (versionIds.length === 0) return [];
  const retriever = new FullTextRetriever(tx, scope);
  const byChunk = new Map<string, RetrievedPassage>();
  for (const probe of lensFor(lens).probes) {
    const result = await retriever.retrieve({
      question: probe,
      limit: PER_PROBE_LIMIT,
      documentVersionIds: [...versionIds],
    });
    for (const passage of result.passages) {
      const existing = byChunk.get(passage.chunkId);
      if (!existing || existing.score < passage.score) byChunk.set(passage.chunkId, passage);
    }
  }
  return [...byChunk.values()].sort((a, b) => b.score - a.score).slice(0, REVIEW_PASSAGE_LIMIT);
}

async function writeCandidates(
  tx: DbTx,
  ctx: { tenantId: string; projectId: string; userId: string },
  claim: ReviewClaim,
  lens: ReviewLensKey,
  candidates: ReadonlyArray<GroundedCandidate>,
): Promise<number> {
  if (candidates.length === 0) return 0;
  let next = await nextCandidateNumber(tx, claim.projectId);

  for (const candidate of candidates) {
    const candidateId = randomUUID();
    const provenanceId = await createReviewProvenance(tx, ctx, claim.projectId, {
      title: candidate.title,
      note: "Candidato propuesto por un modelo a partir de pasajes del expediente.",
      method: `${DOCUMENT_REVIEW_PROMPT_VERSION} · ${lensRef(lens)}`,
    });

    await tx.insert(reviewSchema.documentReviewCandidate).values({
      id: candidateId,
      tenantId: claim.tenantId,
      projectId: claim.projectId,
      runId: claim.runId,
      candidateCode: `IA-${String(next).padStart(3, "0")}`,
      lens,
      support: candidate.support,
      state: "PROPOSED",
      title: candidate.title,
      observation: candidate.observation,
      suggestedCheck: candidate.suggestedCheck,
      provenanceId,
    });
    next += 1;

    await tx.insert(reviewSchema.documentReviewEvidence).values(
      candidate.evidence.map((item, ordinal) => ({
        id: randomUUID(),
        tenantId: claim.tenantId,
        projectId: claim.projectId,
        candidateId,
        role: item.role,
        ordinal,
        chunkId: item.passage.chunkId,
        documentVersionId: item.passage.documentVersionId,
        label: renderCitation(citationFor(item.passage)),
        // The passage's own words. Never the model's, and never a paraphrase.
        quote: item.passage.text,
      })),
    );
  }
  return candidates.length;
}

/**
 * `IA-001`, per project.
 *
 * Deliberately not `QG-…`: a reader scanning two lists must not have to remember which prefix
 * means a rule ran and which means a model suggested something (ADR-035 §4).
 */
async function nextCandidateNumber(tx: DbTx, projectId: string): Promise<number> {
  const result = await tx.execute(sql`
    select coalesce(max(substring(candidate_code from 4)::integer), 0) + 1 as next
      from app.document_review_candidate
     where project_id = ${projectId}
  `);
  return Number((result.rows[0] as { next: number } | undefined)?.next ?? 1);
}

async function settle(
  db: Database,
  ctx: { userId: string; tenantId: string; projectId: string; surface: "job" },
  runId: string,
  outcome: Omit<ReviewOutcome, "runId">,
): Promise<ReviewOutcome> {
  await withDbContext(db, ctx, async (tx) => {
    await advanceRun(tx, runId, outcome.status, {
      passageCount: outcome.passageCount,
      candidatesCreated: outcome.candidatesCreated,
      candidatesRefused: outcome.candidatesRefused,
      error: outcome.note,
    });
  });
  return { runId, ...outcome };
}

async function advanceRun(
  tx: DbTx,
  runId: string,
  to: "COMPLETED" | "FAILED",
  counts: {
    passageCount: number;
    candidatesCreated: number;
    candidatesRefused: number;
    error?: string | null;
  },
): Promise<void> {
  const [current] = await tx
    .select({ status: reviewSchema.documentReviewRun.status })
    .from(reviewSchema.documentReviewRun)
    .where(eq(reviewSchema.documentReviewRun.id, runId));
  if (!current) throw new NotFound("document review run");
  assertRunTransition(current.status, to);

  await tx
    .update(reviewSchema.documentReviewRun)
    .set({
      status: to,
      passageCount: counts.passageCount,
      candidatesCreated: counts.candidatesCreated,
      candidatesRefused: counts.candidatesRefused,
      error: counts.error ?? null,
      claimedAt: null,
      finishedAt: new Date(),
    })
    .where(eq(reviewSchema.documentReviewRun.id, runId));
}

/* ---------------------------------------------------------------------------------------------
 * A person decides
 * ------------------------------------------------------------------------------------------ */

export interface DecidedCandidate {
  readonly candidateId: string;
  readonly fromState: ReviewCandidateState;
  readonly toState: ReviewCandidateState;
}

/**
 * Accept or dismiss a candidate.
 *
 * `quality.review` — the same grant that settles a Quality Gate finding, and for the same reason:
 * deciding what an observation about a study *means* is a reviewer's act, not a specialist's. A
 * specialist can run the review (`quality.write`) and read what it proposed; a reviewer settles it.
 *
 * The justification is mandatory and permanent, and a dismissal is kept exactly as an acceptance
 * is: a study that could quietly lose the record of somebody deciding something was nothing would
 * be a study whose review history is whatever survived.
 */
export async function decideDocumentReviewCandidate(
  db: Database,
  ctx: RequestContext,
  candidateId: string,
  submission: DocumentReviewDecisionSubmission,
): Promise<DecidedCandidate> {
  requireCapability(ctx, "core.documents");
  requireCapability(ctx, "quality.rag_assistant");
  requirePermission(ctx, "quality.review");
  const projectId = requireProject(ctx);
  const parsed = documentReviewDecisionSchema.parse(submission);

  return withDbContext(db, ctx, async (tx) => {
    const [candidate] = await tx
      .select({
        id: reviewSchema.documentReviewCandidate.id,
        code: reviewSchema.documentReviewCandidate.candidateCode,
        state: reviewSchema.documentReviewCandidate.state,
        support: reviewSchema.documentReviewCandidate.support,
        lens: reviewSchema.documentReviewCandidate.lens,
      })
      .from(reviewSchema.documentReviewCandidate)
      .where(
        and(
          eq(reviewSchema.documentReviewCandidate.id, candidateId),
          eq(reviewSchema.documentReviewCandidate.projectId, projectId),
        ),
      );
    if (!candidate) throw new NotFound("document review candidate");

    const transition = decideCandidate(
      candidate.state,
      candidate.support as ReviewSupportKind,
      parsed,
    );

    await tx.insert(reviewSchema.documentReviewDecision).values({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      projectId,
      candidateId,
      decision: transition.decision,
      fromState: transition.fromState,
      toState: transition.toState,
      justification: transition.justification,
      reviewerUserId: ctx.userId,
    });

    await tx
      .update(reviewSchema.documentReviewCandidate)
      .set({ state: transition.toState })
      .where(eq(reviewSchema.documentReviewCandidate.id, candidateId));

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId ?? null },
      {
        action: "documents.review.candidate_decided",
        objectKind: "document_review_candidate",
        objectId: candidateId,
        // The transition, never the justification: a reviewer's reasoning lives on the decision
        // row, attributed and permanent, and a second copy here could disagree with it.
        details: {
          candidate: candidate.code,
          lens: candidate.lens,
          decision: transition.decision,
          from: transition.fromState,
          to: transition.toState,
        },
      },
    );

    return { candidateId, fromState: transition.fromState, toState: transition.toState };
  });
}

/* ---------------------------------------------------------------------------------------------
 * Read models
 * ------------------------------------------------------------------------------------------ */

export interface ReviewRunRow {
  readonly id: string;
  readonly lens: ReviewLensKey;
  readonly lensRef: string;
  readonly status: string;
  readonly adapterKind: string;
  readonly requestedModel: string;
  readonly live: boolean;
  readonly sourceCount: number;
  readonly passageCount: number;
  readonly candidatesCreated: number;
  readonly candidatesRefused: number;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
}

export async function listDocumentReviewRuns(
  db: Database,
  ctx: RequestContext,
  limit = 20,
): Promise<ReadonlyArray<ReviewRunRow>> {
  requireCapability(ctx, "core.documents");
  requirePermission(ctx, "quality.read");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const rows = await tx
      .select({
        id: reviewSchema.documentReviewRun.id,
        lens: reviewSchema.documentReviewRun.lens,
        lensRef: reviewSchema.documentReviewRun.lensRef,
        status: reviewSchema.documentReviewRun.status,
        adapterKind: reviewSchema.documentReviewRun.adapterKind,
        requestedModel: reviewSchema.documentReviewRun.requestedModel,
        passageCount: reviewSchema.documentReviewRun.passageCount,
        candidatesCreated: reviewSchema.documentReviewRun.candidatesCreated,
        candidatesRefused: reviewSchema.documentReviewRun.candidatesRefused,
        error: reviewSchema.documentReviewRun.error,
        createdAt: reviewSchema.documentReviewRun.createdAt,
        finishedAt: reviewSchema.documentReviewRun.finishedAt,
      })
      .from(reviewSchema.documentReviewRun)
      .where(eq(reviewSchema.documentReviewRun.projectId, projectId))
      .orderBy(desc(reviewSchema.documentReviewRun.createdAt))
      .limit(limit);

    // Counted in a second query rather than a correlated subquery: drizzle renders a bare column
    // reference inside `sql` without its table, so `s.run_id = id` would resolve against the
    // subquery's own row and silently count nothing.
    const sourceCounts = await tx
      .select({
        runId: reviewSchema.documentReviewSource.runId,
        count: sql<number>`count(*)::int`,
      })
      .from(reviewSchema.documentReviewSource)
      .where(eq(reviewSchema.documentReviewSource.projectId, projectId))
      .groupBy(reviewSchema.documentReviewSource.runId);
    const countByRun = new Map(sourceCounts.map((row) => [row.runId, Number(row.count)]));

    return rows.map((row) => ({
      ...row,
      lens: row.lens as ReviewLensKey,
      sourceCount: countByRun.get(row.id) ?? 0,
      // `live` is derived rather than stored twice: the adapter's name is the fact, and a boolean
      // beside it could drift from it.
      live: row.adapterKind !== "fake",
    }));
  });
}

export interface ReviewCandidateRow {
  readonly id: string;
  readonly code: string;
  readonly lens: ReviewLensKey;
  readonly support: ReviewSupportKind;
  readonly state: ReviewCandidateState;
  readonly title: string;
  readonly observation: string;
  readonly suggestedCheck: string;
  readonly runId: string;
  readonly adapterKind: string;
  readonly requestedModel: string;
  readonly createdAt: Date;
  readonly evidence: ReadonlyArray<{
    readonly role: string;
    readonly label: string;
    readonly quote: string;
    readonly chunkId: string;
    readonly documentVersionId: string;
  }>;
  readonly decisions: ReadonlyArray<{
    readonly decision: string;
    readonly justification: string;
    readonly reviewerUserId: string;
    readonly decidedAt: Date;
  }>;
}

export async function listDocumentReviewCandidates(
  db: Database,
  ctx: RequestContext,
): Promise<ReadonlyArray<ReviewCandidateRow>> {
  requireCapability(ctx, "core.documents");
  requirePermission(ctx, "quality.read");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const candidates = await tx
      .select({
        id: reviewSchema.documentReviewCandidate.id,
        code: reviewSchema.documentReviewCandidate.candidateCode,
        lens: reviewSchema.documentReviewCandidate.lens,
        support: reviewSchema.documentReviewCandidate.support,
        state: reviewSchema.documentReviewCandidate.state,
        title: reviewSchema.documentReviewCandidate.title,
        observation: reviewSchema.documentReviewCandidate.observation,
        suggestedCheck: reviewSchema.documentReviewCandidate.suggestedCheck,
        runId: reviewSchema.documentReviewCandidate.runId,
        createdAt: reviewSchema.documentReviewCandidate.createdAt,
        adapterKind: reviewSchema.documentReviewRun.adapterKind,
        requestedModel: reviewSchema.documentReviewRun.requestedModel,
      })
      .from(reviewSchema.documentReviewCandidate)
      .innerJoin(
        reviewSchema.documentReviewRun,
        eq(reviewSchema.documentReviewRun.id, reviewSchema.documentReviewCandidate.runId),
      )
      .where(eq(reviewSchema.documentReviewCandidate.projectId, projectId))
      .orderBy(desc(reviewSchema.documentReviewCandidate.createdAt));

    if (candidates.length === 0) return [];

    const evidence = await tx
      .select({
        candidateId: reviewSchema.documentReviewEvidence.candidateId,
        role: reviewSchema.documentReviewEvidence.role,
        label: reviewSchema.documentReviewEvidence.label,
        quote: reviewSchema.documentReviewEvidence.quote,
        chunkId: reviewSchema.documentReviewEvidence.chunkId,
        documentVersionId: reviewSchema.documentReviewEvidence.documentVersionId,
        ordinal: reviewSchema.documentReviewEvidence.ordinal,
      })
      .from(reviewSchema.documentReviewEvidence)
      .where(eq(reviewSchema.documentReviewEvidence.projectId, projectId))
      .orderBy(asc(reviewSchema.documentReviewEvidence.ordinal));

    const decisions = await tx
      .select({
        candidateId: reviewSchema.documentReviewDecision.candidateId,
        decision: reviewSchema.documentReviewDecision.decision,
        justification: reviewSchema.documentReviewDecision.justification,
        reviewerUserId: reviewSchema.documentReviewDecision.reviewerUserId,
        decidedAt: reviewSchema.documentReviewDecision.decidedAt,
      })
      .from(reviewSchema.documentReviewDecision)
      .where(eq(reviewSchema.documentReviewDecision.projectId, projectId))
      .orderBy(asc(reviewSchema.documentReviewDecision.decidedAt));

    return candidates.map((candidate) => ({
      ...candidate,
      lens: candidate.lens as ReviewLensKey,
      support: candidate.support as ReviewSupportKind,
      state: candidate.state as ReviewCandidateState,
      evidence: evidence
        .filter((item) => item.candidateId === candidate.id)
        .map(({ candidateId: _candidateId, ordinal: _ordinal, ...rest }) => rest),
      decisions: decisions
        .filter((item) => item.candidateId === candidate.id)
        .map(({ candidateId: _candidateId, ...rest }) => rest),
    }));
  });
}

/**
 * Provenance for a candidate and for the run that produced it.
 *
 * `SYSTEM_GENERATED` + `DERIVED` is what says *a machine made this*, and `SPECIALIST_REQUIRED` is
 * what says it is not yet anybody's conclusion. The regime is `LIVE_OPERATIONAL`: the documents it
 * reads are `HISTORICAL_OBSERVED`, but the suggestion is not an observation of anything — it was
 * produced by operating this product today, and calling it historical would attach a study's
 * authority to a sentence nobody in the study wrote.
 */
async function createReviewProvenance(
  tx: DbTx,
  ctx: { tenantId: string },
  projectId: string,
  input: { title: string; note: string; method: string },
): Promise<string> {
  const id = randomUUID();
  await tx.execute(sql`
    insert into app.provenance_record
      (id, tenant_id, project_id, regime, origin, transformations, granularity, title, note,
       method, validation_state, captured_at)
    values (${id}, ${ctx.tenantId}, ${projectId}, 'LIVE_OPERATIONAL', 'SYSTEM_GENERATED',
            ARRAY['DERIVED']::app.provenance_transformation[], 'AGGREGATE', ${input.title},
            ${input.note}, ${input.method}, 'SPECIALIST_REQUIRED', now())
  `);
  return id;
}

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new InvalidInput("this action needs a project context");
  return ctx.projectId;
}
