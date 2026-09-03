import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { app, project, provenanceRecord, user } from "./app";
import { parcel } from "./gis";

/**
 * Quality Gate tables (DATA_MODEL.md §3.6, ADR-008, amended by ADR-020).
 *
 * **There is no requirement table.** The rule catalogue is versioned code
 * (`packages/domain/src/quality/requirements.ts`); a finding stores the rule's key and version as
 * text. A `definition jsonb` beside a TypeScript implementation would be one rule with two homes,
 * and making the jsonb authoritative means writing an interpreter for it — the generic rule engine
 * this slice does not build (ADR-020 §1–2).
 *
 * **`document_assertion` is the evidence substrate until documents are ingested.** One extracted
 * statement from the study corpus: a count, a date, an institution, a conclusion — with the
 * human-readable reference it was read from and its own provenance. It carries **no page number**,
 * because we cannot honestly produce one before Slice 6, and an invented page in the one field
 * whose purpose is verification would be the worst thing in this schema.
 *
 * **`specialist_review` is append-only.** A decision is not edited; a later decision is another
 * row. The finding's `state` is the latest decision's outcome, and the reviews are why it got
 * there — which is the record a study needs when somebody asks who dismissed this and on what
 * grounds.
 *
 * Vocabularies are duplicated from @eia/domain on purpose (db must not depend on domain); a test
 * asserts the lists stay identical.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const assertionSourceKind = app.enum("document_assertion_source_kind", [
  /** Extracted from the study corpus by hand; no document version exists in the system yet. */
  "RECONSTRUCTED_CORPUS",
  /** Extracted from an ingested document version. Slice 6. */
  "DOCUMENT_VERSION",
]);

export const qualityRunTrigger = app.enum("quality_run_trigger", ["MANUAL", "SCHEDULED", "EVENT"]);

export const qualityRunStatus = app.enum("quality_run_status", [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
]);

export const findingType = app.enum("quality_finding_type", [
  "NUMERICAL_MISMATCH",
  "GEOGRAPHICAL_MISMATCH",
  "TEMPORAL_MISMATCH",
  "DOCUMENT_COMPLETENESS",
  "CROSS_DOCUMENT_INCONSISTENCY",
  "MISSING_EVIDENCE",
]);

/** Matches `app.attention_severity` deliberately: one severity vocabulary across the product. */
export const findingSeverity = app.enum("quality_finding_severity", ["high", "medium", "low"]);

export const findingState = app.enum("quality_finding_state", [
  "OPEN",
  "UNDER_REVIEW",
  "ACCEPTED",
  "DISMISSED",
  "RESOLVED",
]);

export const evidenceRole = app.enum("quality_evidence_role", ["SOURCE_A", "SOURCE_B", "CONTEXT"]);

export const findingDecision = app.enum("quality_finding_decision", [
  "START_REVIEW",
  "ACCEPT",
  "DISMISS",
  "RESOLVE",
  "REQUEST_INTERDISCIPLINARY",
  "REOPEN",
]);

/**
 * One value read out of the study corpus.
 *
 * Typed three ways rather than one `text`, because a rule comparing dates must compare dates: a
 * string comparison of "25/10/2025" against "2025-10-22" is the kind of quiet wrongness this
 * module cannot afford. Exactly one of the three is populated, enforced by a CHECK in migration
 * 0018.
 */
export const documentAssertion = app.table(
  "document_assertion",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    /** What this asserts, e.g. `parcels.affected_count`. Rules look their inputs up by key. */
    key: text("key").notNull(),
    sourceKind: assertionSourceKind("source_kind").notNull(),
    /** As printed on screen: "Informe social · anexo de afectaciones". Never a file path. */
    sourceRef: text("source_ref").notNull(),
    valueText: text("value_text"),
    valueNumber: numeric("value_number", { precision: 18, scale: 4 }),
    valueDate: text("value_date"),
    /** Whether the corpus asserts the absence of something — the vulnerability conclusion. */
    valueBoolean: boolean("value_boolean"),
    /** The words themselves, shown verbatim beside the finding. */
    quote: text("quote"),
    /** Free qualifier a rule may compare against, e.g. an institution's jurisdiction. */
    qualifier: text("qualifier"),
    /**
     * Where this value was actually read, once the document exists in the system (Slice 6).
     * Null while the assertion is a hand-transcribed excerpt, which is what `source_kind` says.
     * A CHECK ties the two together: claiming `DOCUMENT_VERSION` requires naming a version.
     */
    documentVersionId: uuid("document_version_id"),
    chunkId: uuid("chunk_id"),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_assertion_project_key_ref_key").on(
      t.tenantId,
      t.projectId,
      t.key,
      t.sourceRef,
    ),
    unique("document_assertion_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "document_assertion_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_assertion_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    index("document_assertion_key_idx").on(t.tenantId, t.projectId, t.key),
  ],
);

/** One execution of the rule set over one project. */
export const qualityRun = app.table(
  "quality_run",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    trigger: qualityRunTrigger("trigger").notNull().default("MANUAL"),
    /** The rule keys and versions this run executed, e.g. `rule.affectation_count@1`. */
    requirements: text("requirements").array().notNull(),
    status: qualityRunStatus("status").notNull().default("PENDING"),
    findingsCreated: integer("findings_created").notNull().default(0),
    findingsUpdated: integer("findings_updated").notNull().default(0),
    findingsReopened: integer("findings_reopened").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    initiatedByUserId: uuid("initiated_by_user_id").notNull(),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("quality_run_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "quality_run_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "quality_run_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    foreignKey({
      name: "quality_run_user_fk",
      columns: [t.initiatedByUserId],
      foreignColumns: [user.id],
    }),
    index("quality_run_project_idx").on(t.tenantId, t.projectId, t.createdAt),
  ],
);

/**
 * A disagreement between two sources, and the state of what a person decided about it.
 *
 * `fingerprint` is unique per project: a re-run that finds the same disagreement updates this row
 * rather than raising a second one. Without it a weekly check turns one problem into fifty and
 * quietly undoes every dismissal.
 */
export const qualityFinding = app.table(
  "quality_finding",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    /** Per-project business identifier, `QG-001`. Never the primary key. */
    findingCode: text("finding_code").notNull(),
    fingerprint: text("fingerprint").notNull(),
    firstRunId: uuid("first_run_id").notNull(),
    lastRunId: uuid("last_run_id").notNull(),
    requirementKey: text("requirement_key").notNull(),
    requirementVersion: text("requirement_version").notNull(),
    type: findingType("type").notNull(),
    severity: findingSeverity("severity").notNull(),
    state: findingState("state").notNull().default("OPEN"),
    title: text("title").notNull(),
    explanation: text("explanation").notNull(),
    whyFlagged: text("why_flagged").notNull(),
    suggestedAction: text("suggested_action").notNull(),
    interdisciplinaryReviewRequired: boolean("interdisciplinary_review_required")
      .notNull()
      .default(false),
    /** Set when the finding is about one parcel; drives the Parcel Workspace's Calidad tab. */
    parcelId: uuid("parcel_id"),
    detectedAt: timestamp("detected_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("quality_finding_fingerprint_key").on(t.tenantId, t.projectId, t.fingerprint),
    unique("quality_finding_code_key").on(t.tenantId, t.projectId, t.findingCode),
    unique("quality_finding_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "quality_finding_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "quality_finding_first_run_fk",
      columns: [t.tenantId, t.firstRunId],
      foreignColumns: [qualityRun.tenantId, qualityRun.id],
    }),
    foreignKey({
      name: "quality_finding_last_run_fk",
      columns: [t.tenantId, t.lastRunId],
      foreignColumns: [qualityRun.tenantId, qualityRun.id],
    }),
    foreignKey({
      name: "quality_finding_parcel_fk",
      columns: [t.tenantId, t.parcelId],
      foreignColumns: [parcel.tenantId, parcel.id],
    }).onDelete("set null"),
    foreignKey({
      name: "quality_finding_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    index("quality_finding_state_idx").on(t.tenantId, t.projectId, t.state, t.severity),
    index("quality_finding_parcel_idx").on(t.tenantId, t.projectId, t.parcelId),
  ],
);

/** One side of the comparison, or supporting material. Replaced wholesale when a run re-detects. */
export const findingEvidence = app.table(
  "finding_evidence",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    findingId: uuid("finding_id").notNull(),
    role: evidenceRole("role").notNull(),
    /** A typed locator, validated per kind by zod at the boundary (domain `evidence.ts`). */
    locator: jsonb("locator").notNull(),
    label: text("label").notNull(),
    quote: text("quote").notNull(),
    ordinal: integer("ordinal").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("finding_evidence_ordinal_key").on(t.tenantId, t.findingId, t.ordinal),
    unique("finding_evidence_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "finding_evidence_finding_fk",
      columns: [t.tenantId, t.findingId],
      foreignColumns: [qualityFinding.tenantId, qualityFinding.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "finding_evidence_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A decision, with its reason. Append-only: migration 0019 refuses UPDATE and DELETE.
 *
 * `fromState` and `toState` are stored rather than derived, so the history reads as a sequence of
 * transitions even after the transition table in the domain changes.
 */
export const specialistReview = app.table(
  "specialist_review",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    findingId: uuid("finding_id").notNull(),
    decision: findingDecision("decision").notNull(),
    fromState: findingState("from_state").notNull(),
    toState: findingState("to_state").notNull(),
    justification: text("justification").notNull(),
    reviewerUserId: uuid("reviewer_user_id").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("specialist_review_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "specialist_review_finding_fk",
      columns: [t.tenantId, t.findingId],
      foreignColumns: [qualityFinding.tenantId, qualityFinding.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "specialist_review_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "specialist_review_user_fk",
      columns: [t.reviewerUserId],
      foreignColumns: [user.id],
    }),
    index("specialist_review_finding_idx").on(t.tenantId, t.findingId, t.reviewedAt),
  ],
);
