import {
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { app, project, provenanceRecord, user } from "./app";

/**
 * Report generation tables (ADR-022).
 *
 * **A version's substance is its snapshot.** `report_version.snapshot` holds every figure the
 * chapter states, each with the source it came from, computed deterministically from validated
 * data. It is what is versioned and what a later reader checks; the narrative is a rendering of it
 * and may be absent entirely.
 *
 * **A version is immutable.** No edit, no re-render in place. A changed input produces a new
 * version with its own snapshot, and the previous one keeps exactly what it said — migration 0023
 * refuses UPDATE and DELETE on both `report_version` and `report_section`, by grant and by trigger.
 *
 * **A section's sources are rows, not prose.** `report_section_source` carries the typed locator
 * that ties a section to the metric, validated coding, decided finding or cited passage it rests
 * on, so traceability is queryable rather than embedded in a sentence.
 *
 * Vocabularies are duplicated from @eia/domain on purpose (db must not depend on domain); a test
 * asserts the lists stay identical.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const reportKind = app.enum("generated_report_kind", ["social_chapter"]);

export const reportVersionStatus = app.enum("report_version_status", [
  /** The only status this slice produces. Approval is a workflow it does not build (TD-060). */
  "DRAFT",
]);

export const reportSourceKind = app.enum("report_source_kind", [
  "metric",
  "human_review",
  "quality_finding",
  "document_chunk",
  "provenance",
]);

export const generatedReport = app.table(
  "generated_report",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    kind: reportKind("kind").notNull(),
    title: text("title").notNull(),
    currentVersionId: uuid("current_version_id"),
    createdAt: createdAt(),
  },
  (t) => [
    // One report of each kind per project: a chapter is a thing a study has, not a document a user
    // creates repeatedly. Its history is its versions.
    unique("generated_report_project_kind_key").on(t.tenantId, t.projectId, t.kind),
    unique("generated_report_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "generated_report_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

export const reportVersion = app.table(
  "report_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    reportId: uuid("report_id").notNull(),
    versionLabel: text("version_label").notNull(),
    status: reportVersionStatus("status").notNull().default("DRAFT"),
    /** The deterministic structure this version states. Validated by `reportSnapshotSchema`. */
    snapshot: jsonb("snapshot").notNull(),
    /**
     * Identity of the snapshot's *content*, excluding the instant it was computed. Two generations
     * of unchanged data produce the same digest, which is how "nothing has changed" is detectable.
     */
    snapshotDigest: text("snapshot_digest").notNull(),
    /** The questionnaire version its social figures belong to; versions are never added together. */
    surveyVersionLabel: text("survey_version_label").notNull(),
    /** Null when no generator was configured: the version is complete without prose. */
    narrativeModel: text("narrative_model"),
    narrativePromptVersion: text("narrative_prompt_version"),
    generatedByUserId: uuid("generated_by_user_id").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("report_version_label_key").on(t.tenantId, t.reportId, t.versionLabel),
    unique("report_version_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "report_version_report_fk",
      columns: [t.tenantId, t.reportId],
      foreignColumns: [generatedReport.tenantId, generatedReport.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "report_version_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "report_version_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    foreignKey({
      name: "report_version_user_fk",
      columns: [t.generatedByUserId],
      foreignColumns: [user.id],
    }),
    index("report_version_report_idx").on(t.tenantId, t.reportId, t.generatedAt),
  ],
);

/** One section of one version. Immutable with it. */
export const reportSection = app.table(
  "report_section",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    versionId: uuid("version_id").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    ordinal: integer("ordinal").notNull(),
    /** Product copy: what the section is about. Never generated. */
    summary: text("summary").notNull(),
    /** The paragraph, when a generator wrote one and it survived grounding validation. */
    narrative: text("narrative"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("report_section_version_key").on(t.tenantId, t.versionId, t.key),
    unique("report_section_version_ordinal_key").on(t.tenantId, t.versionId, t.ordinal),
    unique("report_section_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "report_section_version_fk",
      columns: [t.tenantId, t.versionId],
      foreignColumns: [reportVersion.tenantId, reportVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "report_section_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/**
 * What a section rests on, as rows.
 *
 * The snapshot already carries each fact's source; this table is the same lineage in a form a query
 * can traverse — "which sections cite this document version", "what does this chapter rest on" —
 * without parsing jsonb. Typed locator rather than foreign keys to five modules, the same choice
 * `finding_evidence` made and for the same reason.
 */
export const reportSectionSource = app.table(
  "report_section_source",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    sectionId: uuid("section_id").notNull(),
    kind: reportSourceKind("kind").notNull(),
    /** The fact this source belongs to, so a reader can go from a figure to its origin. */
    factKey: text("fact_key").notNull(),
    locator: jsonb("locator").notNull(),
    ordinal: integer("ordinal").notNull(),
  },
  (t) => [
    unique("report_section_source_ordinal_key").on(t.tenantId, t.sectionId, t.ordinal),
    unique("report_section_source_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "report_section_source_section_fk",
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [reportSection.tenantId, reportSection.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "report_section_source_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    index("report_section_source_kind_idx").on(t.tenantId, t.projectId, t.kind),
  ],
);
