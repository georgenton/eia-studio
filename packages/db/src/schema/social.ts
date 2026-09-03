import {
  boolean,
  foreignKey,
  index,
  integer,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { app, project, projectMembership, provenanceRecord, user } from "./app";
import { surveyAnswer, surveyQuestion, surveyVersion } from "./field";

/**
 * Social Intelligence tables (DATA_MODEL.md §3.5, design v0.2 §06).
 *
 * Three kinds of result live here and never merge into one another:
 *
 * **The deterministic half has no tables at all.** Closed-question tabulation is computed from
 * `survey_answer` on read. Storing counts would create a second, staler copy of a number the
 * source rows already determine.
 *
 * **`ai_classification` is a proposal.** It records what a model returned, against which taxonomy
 * version, in which run, with which model and prompt — and it is never edited by a human decision.
 *
 * **`human_review` is the validated coding.** Analytics read its categories; the proposal beside
 * it stays exactly as the model produced it, which is what makes any later comparison of the two
 * meaningful at all.
 *
 * Two design choices worth stating.
 *
 * *The taxonomy is project-scoped*, like `survey_template`, not tenant-wide. A firm will eventually
 * want a reusable library of coding schemes, but the demo taxonomy is a reconstruction made for
 * one project, and a tenant-level table would need its own RLS story, its own sharing rules and a
 * decision about who may edit a scheme other projects are already coded against (TD-042). Scoping
 * it to the project keeps every existing tenancy guarantee intact and postpones nothing that is
 * needed now.
 *
 * *Categories are rows of a version, never shared between versions.* v2 gets its own category rows
 * even when a code is unchanged, so a historic coding can never be re-pointed at a redefined
 * category. That costs a little duplication and buys the guarantee the whole module rests on.
 *
 * Vocabularies are duplicated from @eia/domain on purpose (db must not depend on domain); a test
 * asserts both lists stay identical.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const taxonomyVersionStatus = app.enum("taxonomy_version_status", [
  "DRAFT",
  "PUBLISHED",
  "RETIRED",
]);

export const classificationRunStatus = app.enum("classification_run_status", [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const classificationStatus = app.enum("ai_classification_status", [
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
]);

export const reviewDecision = app.enum("human_review_decision", ["ACCEPTED", "CORRECTED"]);

/** The coding scheme as a concept: a name and an owner. Definitions live in its versions. */
export const taxonomy = app.table(
  "taxonomy",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("taxonomy_project_key_key").on(t.tenantId, t.projectId, t.key),
    unique("taxonomy_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "taxonomy_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/**
 * One immutable coding definition. Classifications and reviews reference this, so once it is
 * `PUBLISHED` nothing about it or its categories may change: the triggers in migration 0016 refuse
 * the UPDATE and the DELETE, exactly as they do for a published `survey_version`.
 */
export const taxonomyVersion = app.table(
  "taxonomy_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    taxonomyId: uuid("taxonomy_id").notNull(),
    versionLabel: text("version_label").notNull(),
    status: taxonomyVersionStatus("status").notNull().default("DRAFT"),
    /** Deterministic fingerprint of the categories; detects a mismatch, does not establish trust. */
    definitionHash: text("definition_hash"),
    /** Where this scheme came from, in words. The demo one says it is a reconstruction. */
    sourceNote: text("source_note"),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    retiredAt: timestamp("retired_at", { withTimezone: true, mode: "date" }),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("taxonomy_version_label_key").on(t.tenantId, t.taxonomyId, t.versionLabel),
    unique("taxonomy_version_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "taxonomy_version_taxonomy_fk",
      columns: [t.tenantId, t.taxonomyId],
      foreignColumns: [taxonomy.tenantId, taxonomy.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "taxonomy_version_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "taxonomy_version_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    index("taxonomy_version_status_idx").on(t.tenantId, t.taxonomyId, t.status),
  ],
);

/** A category of exactly one version. Never reused by another version, even at the same code. */
export const taxonomyCategory = app.table(
  "taxonomy_category",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    versionId: uuid("version_id").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    /** Sent to the classifier verbatim, so it is part of the definition and of its hash. */
    description: text("description").notNull(),
    ordinal: integer("ordinal").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("taxonomy_category_version_code_key").on(t.tenantId, t.versionId, t.code),
    unique("taxonomy_category_version_ordinal_key").on(t.tenantId, t.versionId, t.ordinal),
    unique("taxonomy_category_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "taxonomy_category_version_fk",
      columns: [t.tenantId, t.versionId],
      foreignColumns: [taxonomyVersion.tenantId, taxonomyVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "taxonomy_category_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/**
 * One evaluation: a taxonomy version, a source question, a model and a prompt, fixed together.
 *
 * A run is the unit that makes a proposal auditable — "which text, which scheme, which model,
 * which prompt produced this" — and it is never rewritten. Changing the model, the prompt or the
 * taxonomy means a **new run**, so historic classifications keep the configuration they were made
 * under and no "latest settings" lookup can reinterpret them.
 *
 * `requested_model` is what the configuration asked for; `resolved_model` is what the provider
 * says answered. They can differ, and an evaluation that reported only the first would be naming
 * a model it never ran.
 */
export const classificationRun = app.table(
  "classification_run",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    taxonomyVersionId: uuid("taxonomy_version_id").notNull(),
    sourceSurveyVersionId: uuid("source_survey_version_id").notNull(),
    sourceQuestionId: uuid("source_question_id").notNull(),
    requestedModel: text("requested_model").notNull(),
    resolvedModel: text("resolved_model"),
    provider: text("provider"),
    /** Which adapter answered: `ai-gateway` in staging, `fake` in tests. Never silently swapped. */
    classifierKind: text("classifier_kind").notNull(),
    promptVersion: text("prompt_version").notNull(),
    promptHash: text("prompt_hash").notNull(),
    status: classificationRunStatus("status").notNull().default("PENDING"),
    initiatedByUserId: uuid("initiated_by_user_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    error: text("error"),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("classification_run_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "classification_run_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "classification_run_taxonomy_version_fk",
      columns: [t.tenantId, t.taxonomyVersionId],
      foreignColumns: [taxonomyVersion.tenantId, taxonomyVersion.id],
    }),
    foreignKey({
      name: "classification_run_survey_version_fk",
      columns: [t.tenantId, t.sourceSurveyVersionId],
      foreignColumns: [surveyVersion.tenantId, surveyVersion.id],
    }),
    foreignKey({
      name: "classification_run_question_fk",
      columns: [t.tenantId, t.sourceQuestionId],
      foreignColumns: [surveyQuestion.tenantId, surveyQuestion.id],
    }),
    foreignKey({
      name: "classification_run_initiator_fk",
      columns: [t.initiatedByUserId],
      foreignColumns: [user.id],
    }),
    foreignKey({
      name: "classification_run_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    index("classification_run_project_status_idx").on(t.tenantId, t.projectId, t.status),
  ],
);

/**
 * One proposal for one answer, inside one run.
 *
 * The row is created `PENDING` by the request that started the run and completed by the worker, so
 * the queue is the table itself rather than a second, divergent job store. `claimed_at` and
 * `attempts` are how one worker takes a row exactly once; the unique key on `(run, answer)` is why
 * two workers cannot both succeed.
 *
 * No provider response body and no model reasoning is stored — only the structured result the
 * product uses (§14).
 */
export const aiClassification = app.table(
  "ai_classification",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    runId: uuid("run_id").notNull(),
    answerId: uuid("answer_id").notNull(),
    status: classificationStatus("status").notNull().default("PENDING"),
    /** The model's own heuristic, 0–1. Not a calibrated probability (AI_GOVERNANCE.md). */
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    needsReview: boolean("needs_review").notNull().default(false),
    modelId: text("model_id"),
    provider: text("provider"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    latencyMs: integer("latency_ms"),
    attempts: integer("attempts").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
    error: text("error"),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("ai_classification_run_answer_key").on(t.tenantId, t.runId, t.answerId),
    unique("ai_classification_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "ai_classification_run_fk",
      columns: [t.tenantId, t.runId],
      foreignColumns: [classificationRun.tenantId, classificationRun.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_classification_answer_fk",
      columns: [t.tenantId, t.answerId],
      foreignColumns: [surveyAnswer.tenantId, surveyAnswer.id],
    }),
    foreignKey({
      name: "ai_classification_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_classification_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    index("ai_classification_run_status_idx").on(t.tenantId, t.runId, t.status),
    index("ai_classification_answer_idx").on(t.tenantId, t.answerId),
  ],
);

/** The proposal's category selections, normalised so a distribution is a GROUP BY. */
export const aiClassificationCategory = app.table(
  "ai_classification_category",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    classificationId: uuid("classification_id").notNull(),
    categoryId: uuid("category_id").notNull(),
  },
  (t) => [
    unique("ai_classification_category_key").on(t.tenantId, t.classificationId, t.categoryId),
    foreignKey({
      name: "ai_classification_category_classification_fk",
      columns: [t.tenantId, t.classificationId],
      foreignColumns: [aiClassification.tenantId, aiClassification.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_classification_category_category_fk",
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [taxonomyCategory.tenantId, taxonomyCategory.id],
    }),
    foreignKey({
      name: "ai_classification_category_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    index("ai_classification_category_category_idx").on(t.tenantId, t.categoryId),
  ],
);

/**
 * The specialist's decision, and the coding the product treats as true.
 *
 * One final review per proposal (the unique key), and no edit afterwards: migration 0016 refuses
 * the UPDATE and the DELETE. A later slice may add a superseding re-review with its own actor and
 * reason; silently editing this row would leave no trace that the coding changed.
 *
 * `decision` is derived from the labels by the use-case, never accepted from the client, so a
 * correction cannot be recorded as an acceptance.
 */
export const humanReview = app.table(
  "human_review",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    classificationId: uuid("classification_id").notNull(),
    answerId: uuid("answer_id").notNull(),
    taxonomyVersionId: uuid("taxonomy_version_id").notNull(),
    reviewerUserId: uuid("reviewer_user_id").notNull(),
    reviewerMembershipId: uuid("reviewer_membership_id").notNull(),
    decision: reviewDecision("decision").notNull(),
    /** Elapsed operational time, not active cognitive work (§49). */
    reviewStartedAt: timestamp("review_started_at", { withTimezone: true, mode: "date" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("human_review_classification_key").on(t.tenantId, t.classificationId),
    unique("human_review_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "human_review_classification_fk",
      columns: [t.tenantId, t.classificationId],
      foreignColumns: [aiClassification.tenantId, aiClassification.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "human_review_answer_fk",
      columns: [t.tenantId, t.answerId],
      foreignColumns: [surveyAnswer.tenantId, surveyAnswer.id],
    }),
    foreignKey({
      name: "human_review_taxonomy_version_fk",
      columns: [t.tenantId, t.taxonomyVersionId],
      foreignColumns: [taxonomyVersion.tenantId, taxonomyVersion.id],
    }),
    foreignKey({
      name: "human_review_reviewer_fk",
      columns: [t.tenantId, t.reviewerMembershipId],
      foreignColumns: [projectMembership.tenantId, projectMembership.id],
    }),
    foreignKey({
      name: "human_review_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "human_review_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    index("human_review_project_idx").on(t.tenantId, t.projectId),
  ],
);

/** The validated categories. The only rows a validated distribution counts. */
export const humanReviewCategory = app.table(
  "human_review_category",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    reviewId: uuid("review_id").notNull(),
    categoryId: uuid("category_id").notNull(),
  },
  (t) => [
    unique("human_review_category_key").on(t.tenantId, t.reviewId, t.categoryId),
    foreignKey({
      name: "human_review_category_review_fk",
      columns: [t.tenantId, t.reviewId],
      foreignColumns: [humanReview.tenantId, humanReview.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "human_review_category_category_fk",
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [taxonomyCategory.tenantId, taxonomyCategory.id],
    }),
    foreignKey({
      name: "human_review_category_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    index("human_review_category_category_idx").on(t.tenantId, t.categoryId),
  ],
);
