import { foreignKey, index, integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { app, project, provenanceRecord, user } from "./app";
import { documentChunk, documentVersion, sourceDocument } from "./documents";

/**
 * AI document review (ADR-035).
 *
 * **These are not Quality Gate tables, and that is the decision.** `quality_finding` carries a
 * `requirement_key` and a `requirement_version` naming a deterministic rule in versioned code
 * (ADR-020); a run records which rules it executed. An AI candidate has no rule — it is a model's
 * suggestion — so writing one into `quality_finding` would require inventing a requirement key,
 * and a study would then carry a finding attributed to a rule that never ran. Four tables of their
 * own, surfaced beside the Quality Gate in words that cannot be mistaken for it, is the honest
 * shape (ADR-035 §3).
 *
 * The four:
 *
 * | Table | Holds | Mutability |
 * |---|---|---|
 * | `document_review_run` | one execution of one lens over a declared corpus | status advances; the corpus and the model never change |
 * | `document_review_source` | which `DocumentVersion`s the run was allowed to read | write-once |
 * | `document_review_candidate` | one suggestion, and the state a person put it in | state advances; the model's words never change |
 * | `document_review_evidence` | the passages it rests on | write-once |
 * | `document_review_decision` | a person's accept/dismiss, with a mandatory reason | append-only |
 *
 * **The corpus is recorded, not inferred.** `document_review_source` exists so that "which
 * documents did this run actually read?" is answerable a year later from the row rather than by
 * re-running the selection logic against a corpus that has since changed.
 *
 * Vocabularies are duplicated from @eia/domain on purpose (db must not depend on domain); a test
 * asserts the lists stay identical.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const reviewRunStatus = app.enum("document_review_run_status", [
  "QUEUED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
]);

/** The bounded set of comparisons a review may make. The candidate's whole classification. */
export const reviewLens = app.enum("document_review_lens", [
  "numerical_consistency",
  "dates_chronology",
  "project_identity",
  "locations_institutions",
  "social_conclusions_support",
  "management_plan_application_area",
  "general_cross_document",
]);

export const reviewCandidateState = app.enum("document_review_candidate_state", [
  "PROPOSED",
  "ACCEPTED",
  "DISMISSED",
]);

export const reviewCandidateDecision = app.enum("document_review_candidate_decision", [
  "ACCEPT",
  "DISMISS",
  "REOPEN",
]);

/** Two named sources that disagree, or one passage and an assertion. Only the first is acceptable. */
export const reviewSupportKind = app.enum("document_review_support", [
  "TWO_SIDED",
  "SINGLE_SOURCE",
]);

export const reviewEvidenceRole = app.enum("document_review_evidence_role", [
  "SOURCE_A",
  "SOURCE_B",
  "CONTEXT",
]);

export const documentReviewRun = app.table(
  "document_review_run",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    lens: reviewLens("lens").notNull(),
    /** `numerical_consistency@1`: which version of the lens produced these candidates. */
    lensRef: text("lens_ref").notNull(),
    status: reviewRunStatus("status").notNull().default("QUEUED"),
    /**
     * What actually answered, recorded at enqueue and never chosen by a client.
     *
     * `adapter_kind` is `fake` or `ai-gateway` and `live` says whether text left this system.
     * Without them a row read a year from now could not say whether a person's accepted candidate
     * came from a model or from a deterministic stand-in — the artefact IG4-001 exists to prevent.
     */
    adapterKind: text("adapter_kind").notNull(),
    requestedModel: text("requested_model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    /** How many passages the retriever found. Zero means the model was never called. */
    passageCount: integer("passage_count").notNull().default(0),
    candidatesCreated: integer("candidates_created").notNull().default(0),
    /**
     * Candidates the model returned that could not be grounded — an index it never saw, a
     * forbidden compliance word, a shape the schema refuses. Counted rather than absorbed, so how
     * often it happens is visible on the surface instead of only in a log.
     */
    candidatesRefused: integer("candidates_refused").notNull().default(0),
    /** Bounded operational text on failure. Never a passage, never the model's response body. */
    error: text("error"),
    /** Attempts and claim time: the same crash-loop bound extraction uses (ADR-033). */
    attempts: integer("attempts").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    initiatedByUserId: uuid("initiated_by_user_id").notNull(),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_review_run_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "document_review_run_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_review_run_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    foreignKey({
      name: "document_review_run_user_fk",
      columns: [t.initiatedByUserId],
      foreignColumns: [user.id],
    }),
    index("document_review_run_project_idx").on(t.tenantId, t.projectId, t.createdAt),
    index("document_review_run_queue_idx").on(t.status, t.claimedAt),
  ],
);

/**
 * One document version this run was allowed to read.
 *
 * Written at enqueue, after the privacy gate passed, and never afterwards: the corpus a run
 * reviewed is part of what the run *is*. `privacy_classification_at_run` is the classification as
 * it stood, because a version's claim can be revised later and a run must not appear to have been
 * authorised by a decision made after it.
 */
export const documentReviewSource = app.table(
  "document_review_source",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    runId: uuid("run_id").notNull(),
    documentId: uuid("document_id").notNull(),
    documentVersionId: uuid("document_version_id").notNull(),
    privacyClassificationAtRun: text("privacy_classification_at_run").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_review_source_run_version_key").on(t.tenantId, t.runId, t.documentVersionId),
    unique("document_review_source_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "document_review_source_run_fk",
      columns: [t.tenantId, t.runId],
      foreignColumns: [documentReviewRun.tenantId, documentReviewRun.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_review_source_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [sourceDocument.tenantId, sourceDocument.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_review_source_version_fk",
      columns: [t.tenantId, t.documentVersionId],
      foreignColumns: [documentVersion.tenantId, documentVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_review_source_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/**
 * One suggestion, with the state a person put it in.
 *
 * The model's three texts are written once and never updated: what it said is the record, and a
 * specialist's disagreement with it is a `document_review_decision`, not an edit. Migration 0044
 * enforces that with a trigger that refuses an UPDATE touching any column but `state`.
 *
 * There is no severity and no confidence. A severity would be a model deciding how much attention
 * a study deserves; a confidence would be a model's opinion of its own prose, with nothing to
 * calibrate it against (ADR-035 §5).
 */
export const documentReviewCandidate = app.table(
  "document_review_candidate",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    runId: uuid("run_id").notNull(),
    /** Per-project business identifier, `IA-001`. Deliberately not `QG-…`: a reader must not confuse the two. */
    candidateCode: text("candidate_code").notNull(),
    lens: reviewLens("lens").notNull(),
    support: reviewSupportKind("support").notNull(),
    state: reviewCandidateState("state").notNull().default("PROPOSED"),
    title: text("title").notNull(),
    observation: text("observation").notNull(),
    suggestedCheck: text("suggested_check").notNull(),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_review_candidate_code_key").on(t.tenantId, t.projectId, t.candidateCode),
    unique("document_review_candidate_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "document_review_candidate_run_fk",
      columns: [t.tenantId, t.runId],
      foreignColumns: [documentReviewRun.tenantId, documentReviewRun.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_review_candidate_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_review_candidate_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    index("document_review_candidate_state_idx").on(t.tenantId, t.projectId, t.state),
  ],
);

/**
 * A passage the candidate rests on, by chunk id.
 *
 * The chunk is referenced rather than copied, and the quote is stored beside it — the same shape
 * the Quality Gate's evidence uses, for the same reason: the reference lets a reader open the
 * passage, and the stored quote is what the candidate was actually made from, so a later
 * re-chunking (which cannot happen: chunks are immutable) could never silently change what a
 * candidate appears to have said.
 */
export const documentReviewEvidence = app.table(
  "document_review_evidence",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    candidateId: uuid("candidate_id").notNull(),
    role: reviewEvidenceRole("role").notNull(),
    ordinal: integer("ordinal").notNull(),
    chunkId: uuid("chunk_id").notNull(),
    documentVersionId: uuid("document_version_id").notNull(),
    /** As rendered: `DOC-002 v1 · p. 3 · pasaje 2`. The reader's handle on the passage. */
    label: text("label").notNull(),
    /** The passage's own words. Never a paraphrase, and never the model's. */
    quote: text("quote").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_review_evidence_ordinal_key").on(t.tenantId, t.candidateId, t.ordinal),
    unique("document_review_evidence_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "document_review_evidence_candidate_fk",
      columns: [t.tenantId, t.candidateId],
      foreignColumns: [documentReviewCandidate.tenantId, documentReviewCandidate.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_review_evidence_chunk_fk",
      columns: [t.tenantId, t.chunkId],
      foreignColumns: [documentChunk.tenantId, documentChunk.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_review_evidence_version_fk",
      columns: [t.tenantId, t.documentVersionId],
      foreignColumns: [documentVersion.tenantId, documentVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_review_evidence_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A person's decision about a candidate, with its reason. Append-only.
 *
 * Both halves are preserved deliberately: the model's suggestion stays exactly as it was written,
 * and the specialist's judgement of it — including a dismissal — is kept beside it forever. A
 * dismissed candidate that could be deleted would let a study quietly lose the record that
 * somebody looked at something and decided it was nothing.
 */
export const documentReviewDecision = app.table(
  "document_review_decision",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    candidateId: uuid("candidate_id").notNull(),
    decision: reviewCandidateDecision("decision").notNull(),
    fromState: reviewCandidateState("from_state").notNull(),
    toState: reviewCandidateState("to_state").notNull(),
    justification: text("justification").notNull(),
    reviewerUserId: uuid("reviewer_user_id").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("document_review_decision_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "document_review_decision_candidate_fk",
      columns: [t.tenantId, t.candidateId],
      foreignColumns: [documentReviewCandidate.tenantId, documentReviewCandidate.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_review_decision_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_review_decision_user_fk",
      columns: [t.reviewerUserId],
      foreignColumns: [user.id],
    }),
    index("document_review_decision_candidate_idx").on(t.tenantId, t.candidateId, t.decidedAt),
  ],
);
