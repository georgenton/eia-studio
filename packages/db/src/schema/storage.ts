import { bigint, foreignKey, index, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { app, project, user } from "./app";

/**
 * Object storage metadata (ADR-031). The bytes live in an S3-compatible bucket; PostgreSQL holds
 * what the product knows *about* them, and RLS decides who may know it.
 *
 * Vocabularies are duplicated from `@eia/domain` on purpose (db must not depend on domain); a test
 * asserts the lists stay identical.
 */
export const storageNamespace = app.enum("storage_namespace", [
  "documents",
  "field-media",
  // A consultancy's own .docx templates, and the documents this product generated from them
  // (ADR-036). Never mixed with `documents`: different formats, different readers, different
  // retention questions — and a generated draft must not be reachable by a corpus query.
  "templates",
  "generated",
]);

export const uploadIntentState = app.enum("upload_intent_state", [
  "ISSUED",
  "FINALIZED",
  "ABANDONED",
]);

/**
 * One authorised upload, recorded before a single byte exists.
 *
 * ## Why the intent is a row and not only a signature
 *
 * The presigned URL already carries the key, the type and an expiry. Persisting the intent buys
 * the thing the signature cannot: at finalize the server can ask **"did I issue this key, to this
 * person, for this project, for this declared file, and has it been used already?"** — rather than
 * re-deriving an answer from what the client sends back. A client that replays a finalize gets the
 * first result; a client that finalizes a key nobody issued gets nothing.
 *
 * The declared filename is kept here, and this is the one place it exists before the object does.
 * It is **not** in the storage key: a key is read from log lines and bucket listings, and
 * `Ficha_Maria_Quizhpe.pdf` names a person.
 */
export const uploadIntent = app.table(
  "upload_intent",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    namespace: storageNamespace("namespace").notNull(),
    /** The key the **server** chose. Unique, so a key is issued once and finalized once. */
    objectKey: text("object_key").notNull(),
    declaredFilename: text("declared_filename").notNull(),
    declaredMimeType: text("declared_mime_type").notNull(),
    declaredSizeBytes: bigint("declared_size_bytes", { mode: "number" }).notNull(),
    /** The ceiling the server signed for, which finalize checks the stored object against. */
    maxBytes: bigint("max_bytes", { mode: "number" }).notNull(),
    state: uploadIntentState("state").notNull().default("ISSUED"),
    issuedByUserId: uuid("issued_by_user_id").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    unique("upload_intent_object_key_key").on(t.tenantId, t.objectKey),
    unique("upload_intent_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "upload_intent_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "upload_intent_user_fk",
      columns: [t.issuedByUserId],
      foreignColumns: [user.id],
    }),
    index("upload_intent_project_state_idx").on(t.tenantId, t.projectId, t.state),
  ],
);

/**
 * A stored object, after the server has verified it is actually there.
 *
 * Written only by finalize, and only once the provider has confirmed the object's existence, size
 * and type. An upload the client *said* succeeded and this row are different things, and the row
 * is the one anything else may read.
 *
 * `sha256` is computed by this product from the bytes it read back. It is deliberately not the
 * provider's `ETag`: for a multipart upload that is a digest of digests, and a value in a column
 * called `sha256` that no reader can reproduce is worse than no column.
 */
export const storedObject = app.table(
  "stored_object",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    namespace: storageNamespace("namespace").notNull(),
    objectKey: text("object_key").notNull(),
    /** What the person called it. Shown to people; never part of the key. */
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("stored_object_object_key_key").on(t.tenantId, t.objectKey),
    unique("stored_object_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "stored_object_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "stored_object_user_fk",
      columns: [t.uploadedByUserId],
      foreignColumns: [user.id],
    }),
    index("stored_object_project_namespace_idx").on(t.tenantId, t.projectId, t.namespace),
    // Duplicate detection is per project and per namespace, never across tenants: whether another
    // firm holds the same file is not a fact this product may reveal (ADR-031 §6).
    index("stored_object_hash_idx").on(t.tenantId, t.projectId, t.sha256),
  ],
);
