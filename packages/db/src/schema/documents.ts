import {
  boolean,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { app, project, provenanceRecord, user } from "./app";

/**
 * Document intelligence tables (DATA_MODEL.md §3.2, ADR-021).
 *
 * **A version is a file; a document is a name.** `source_document` holds the identity a person uses
 * — `DOC-002`, "Informe social" — and points at a current version. `document_version` holds the
 * text that was actually ingested, its hash, and the chunking strategy that produced its chunks. A
 * newer file is a new version, never an edit, because a citation made against the old one has to
 * keep resolving to the words it cited.
 *
 * **A chunk is immutable and belongs to exactly one version.** Re-chunking is impossible rather than
 * discouraged: migration 0021 refuses UPDATE and DELETE on `document_chunk` while its version
 * stands. A different chunking strategy produces a new version.
 *
 * **There is no embedding column.** No provider is configured anywhere, and a vector filled by a
 * deterministic stand-in is indistinguishable from one a model produced — the artefact IG4-001
 * exists to prevent (ADR-021). Retrieval is a generated `tsvector` with a GIN index, added in the
 * SQL migration because Drizzle has no column type for a stored generated column.
 *
 * Vocabularies are duplicated from @eia/domain on purpose (db must not depend on domain); a test
 * asserts the lists stay identical.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const documentKind = app.enum("source_document_kind", [
  "report",
  "annex",
  "minutes",
  "plan",
  "legal",
  "other",
]);

export const documentTextSource = app.enum("document_text_source", [
  /** Transcribed by hand from the study's file; the original is external source material. */
  "RECONSTRUCTED_EXCERPT",
  "PLAIN_TEXT",
  "PDF_TEXT",
]);

export const sourceDocument = app.table(
  "source_document",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    /** `DOC-001`, unique per project. A business identifier, never the primary key. */
    code: text("code").notNull(),
    title: text("title").notNull(),
    kind: documentKind("kind").notNull(),
    /**
     * Ingestion refuses a document flagged true (domain `assertIngestable`): the deidentification
     * pipeline that would let its text be chunked and retrieved does not exist. The column is here
     * so the refusal has something to read, not so the flag can be cleared to get past it.
     */
    containsPii: boolean("contains_pii").notNull().default(false),
    currentVersionId: uuid("current_version_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("source_document_project_code_key").on(t.tenantId, t.projectId, t.code),
    unique("source_document_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "source_document_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

export const documentVersion = app.table(
  "document_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    documentId: uuid("document_id").notNull(),
    versionLabel: text("version_label").notNull(),
    textSource: documentTextSource("text_source").notNull(),
    /** Human-readable origin, printed beside every citation of this version. */
    sourceNote: text("source_note").notNull(),
    /** sha256 of the concatenated extracted text. Detects a re-ingestion of identical content. */
    contentHash: text("content_hash").notNull(),
    pageCount: integer("page_count").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    /** `paragraph-merge@1`. Recorded so a citation's boundaries are reproducible. */
    chunkingStrategy: text("chunking_strategy").notNull(),
    /**
     * Object storage key for the original file, when there is one. Null for the pilot's excerpts:
     * the originals are external source material and are not in this system.
     */
    storageKey: text("storage_key"),
    /**
     * Who imported it, when a person did. **Null for a version the project fixture seeded**:
     * nobody performed that action, and attributing it to a demo identity would put a name on
     * something they did not do. The surface says "cargado con el proyecto de demostración".
     */
    importedByUserId: uuid("imported_by_user_id"),
    importedAt: timestamp("imported_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_version_label_key").on(t.tenantId, t.documentId, t.versionLabel),
    unique("document_version_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "document_version_document_fk",
      columns: [t.tenantId, t.documentId],
      foreignColumns: [sourceDocument.tenantId, sourceDocument.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_version_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_version_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    foreignKey({
      name: "document_version_user_fk",
      columns: [t.importedByUserId],
      foreignColumns: [user.id],
    }),
    index("document_version_document_idx").on(t.tenantId, t.documentId, t.importedAt),
  ],
);

/**
 * One retrievable passage. Immutable: a citation points here by id.
 *
 * The searchable `tsvector` is a stored generated column added by migration 0021 — Drizzle has no
 * type for one, and it must be generated rather than maintained so it can never disagree with the
 * text it indexes.
 */
export const documentChunk = app.table(
  "document_chunk",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    versionId: uuid("version_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    pageFrom: integer("page_from").notNull(),
    pageTo: integer("page_to").notNull(),
    /** Character offsets into the version's concatenated text; meaningless across versions. */
    charFrom: integer("char_from").notNull(),
    charTo: integer("char_to").notNull(),
    text: text("text").notNull(),
    /** sha256 of the chunk's text: two chunks with the same hash hold the same words. */
    contentHash: text("content_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_chunk_version_ordinal_key").on(t.tenantId, t.versionId, t.ordinal),
    unique("document_chunk_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "document_chunk_version_fk",
      columns: [t.tenantId, t.versionId],
      foreignColumns: [documentVersion.tenantId, documentVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_chunk_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    index("document_chunk_version_idx").on(t.tenantId, t.versionId, t.ordinal),
  ],
);
