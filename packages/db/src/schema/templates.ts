import {
  bigint,
  foreignKey,
  index,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { app, project, provenanceRecord, user } from "./app";
import { reportVersion } from "./reports";
import { storedObject } from "./storage";

/**
 * The versioned template library, and what was generated from it (ADR-036).
 *
 * **A template is a name; a version is a file.** `report_template` holds the identity a person uses
 * — *Carátula del estudio*, an annex, a chapter — and `report_template_version` holds the `.docx`
 * that was actually uploaded, its hash, the locale it is written in, the placeholder manifest
 * validation found in it, and the state somebody put it in.
 *
 * **ES and EN are different versions, never one translated.** A consultancy's Spanish deliverable
 * carries their own register and their own legal phrasing; machine-translating it would produce a
 * document the firm did not write and would have to sign. The unique constraint is per template,
 * locale and label.
 *
 * **An activated version is immutable.** From the moment documents may be generated from it, a
 * deliverable can name it — so the row is frozen by a trigger that permits only the state column to
 * move, and the file behind it is a `stored_object`, which has been immutable since ADR-031.
 *
 * `generated_document` is the artefact: one row per rendering, pointing at the template version it
 * used, the report version and snapshot digest its figures came from, the locale, and the stored
 * object holding the bytes. Written once.
 *
 * Vocabularies are duplicated from @eia/domain on purpose (db must not depend on domain); a test
 * asserts the lists stay identical.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const templateKind = app.enum("report_template_kind", ["cover", "chapter", "annex"]);

export const templateLocale = app.enum("report_template_locale", ["es-EC", "en"]);

export const templateVersionState = app.enum("report_template_version_state", [
  "UPLOADED",
  "VALIDATED",
  "ACTIVE",
  "SUPERSEDED",
]);

export const reportTemplate = app.table(
  "report_template",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    /** `TPL-001`, unique per project. A business identifier, never the primary key. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: templateKind("kind").notNull(),
    /** What this template is for, in the firm's own words. Shown beside it, never generated. */
    purpose: text("purpose").notNull(),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("report_template_project_code_key").on(t.tenantId, t.projectId, t.code),
    unique("report_template_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "report_template_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "report_template_user_fk",
      columns: [t.createdByUserId],
      foreignColumns: [user.id],
    }),
  ],
);

export const reportTemplateVersion = app.table(
  "report_template_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    templateId: uuid("template_id").notNull(),
    versionLabel: text("version_label").notNull(),
    locale: templateLocale("locale").notNull(),
    state: templateVersionState("state").notNull().default("UPLOADED"),
    /** The verified upload holding the `.docx`. Never a path, never a name a client proposed. */
    storedObjectId: uuid("stored_object_id").notNull(),
    /** SHA-256 of the file, computed from the bytes read back out of the provider (ADR-031). */
    fileSha256: text("file_sha256").notNull(),
    originalFilename: text("original_filename").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /**
     * What validation found: supported placeholders, unknown ones, required ones, containers and a
     * tag count. Stored so a reader sees it without the file being parsed again — and so the list
     * that blocked an activation is still readable after somebody fixes the template.
     */
    manifest: jsonb("manifest"),
    /** When the file was last parsed. Null while the version has only been uploaded. */
    validatedAt: timestamp("validated_at", { withTimezone: true, mode: "date" }),
    /** Bounded operational text when validation could not read the file at all. */
    validationError: text("validation_error"),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "date" }),
    activatedByUserId: uuid("activated_by_user_id"),
    uploadedByUserId: uuid("uploaded_by_user_id"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("report_template_version_label_key").on(
      t.tenantId,
      t.templateId,
      t.locale,
      t.versionLabel,
    ),
    unique("report_template_version_tenant_id_id_key").on(t.tenantId, t.id),
    // One verified object backs exactly one template version, as one backs one document version.
    unique("report_template_version_object_key").on(t.tenantId, t.storedObjectId),
    foreignKey({
      name: "report_template_version_template_fk",
      columns: [t.tenantId, t.templateId],
      foreignColumns: [reportTemplate.tenantId, reportTemplate.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "report_template_version_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "report_template_version_object_fk",
      columns: [t.tenantId, t.storedObjectId],
      foreignColumns: [storedObject.tenantId, storedObject.id],
    }),
    foreignKey({
      name: "report_template_version_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    foreignKey({
      name: "report_template_version_uploaded_by_fk",
      columns: [t.uploadedByUserId],
      foreignColumns: [user.id],
    }),
    foreignKey({
      name: "report_template_version_activated_by_fk",
      columns: [t.activatedByUserId],
      foreignColumns: [user.id],
    }),
    // A re-upload of the same bytes to the same template is answered, not duplicated.
    index("report_template_version_hash_idx").on(t.tenantId, t.templateId, t.fileSha256),
    index("report_template_version_state_idx").on(t.tenantId, t.projectId, t.state),
  ],
);

/**
 * One generated `.docx`, and everything needed to explain it a year later.
 *
 * Written once. A regeneration is another row, because the figures may have moved and the previous
 * document is what somebody was handed.
 *
 * `snapshot_digest` is the SHA-256 of the **snapshot JSON**, not merely the report version's id:
 * the id says which version, the digest says which bytes of it, and the two together are what
 * makes "reproduce this document" a question with an answer.
 */
export const generatedDocument = app.table(
  "generated_document",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    templateVersionId: uuid("template_version_id").notNull(),
    /** Null for a template whose placeholders need no report snapshot (a cover, an annex). */
    reportVersionId: uuid("report_version_id"),
    snapshotDigest: text("snapshot_digest"),
    locale: templateLocale("locale").notNull(),
    /** The verified stored object holding the generated bytes, in the `generated` namespace. */
    storedObjectId: uuid("stored_object_id").notNull(),
    fileSha256: text("file_sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /**
     * Which placeholders rendered a declared *no value*. Recorded rather than inferred, so a reader
     * of the archive can tell a blank the project genuinely had from one a later change created.
     */
    declaredAbsent: text("declared_absent").array().notNull().default([]),
    /** Null when no prose was generated, which is the ordinary case (ADR-021 §4). */
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
    unique("generated_document_tenant_id_id_key").on(t.tenantId, t.id),
    unique("generated_document_object_key").on(t.tenantId, t.storedObjectId),
    foreignKey({
      name: "generated_document_template_version_fk",
      columns: [t.tenantId, t.templateVersionId],
      foreignColumns: [reportTemplateVersion.tenantId, reportTemplateVersion.id],
    }),
    foreignKey({
      name: "generated_document_report_version_fk",
      columns: [t.tenantId, t.reportVersionId],
      foreignColumns: [reportVersion.tenantId, reportVersion.id],
    }),
    foreignKey({
      name: "generated_document_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "generated_document_object_fk",
      columns: [t.tenantId, t.storedObjectId],
      foreignColumns: [storedObject.tenantId, storedObject.id],
    }),
    foreignKey({
      name: "generated_document_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    foreignKey({
      name: "generated_document_user_fk",
      columns: [t.generatedByUserId],
      foreignColumns: [user.id],
    }),
    index("generated_document_project_idx").on(t.tenantId, t.projectId, t.generatedAt),
  ],
);
