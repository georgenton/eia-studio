import {
  foreignKey,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { project, user } from "./app";

/**
 * The client portal's projection schema (ADR-009, ADR-027).
 *
 * **Why its own schema and not a table in `app`.** The whole architecture of this surface is that
 * the client's page reads a projection and never the operational record. A publication living
 * beside `survey_answer` and `quality_finding` would make that a convention; living in `portal`
 * makes it a boundary a grant can be written against — which is what the future external role
 * needs, and what `eia_portal` will be given when the grant and session model arrive (TD-005).
 *
 * **Why nothing is granted to `eia_portal` yet.** There is no external client authentication in
 * this wave, so there is no session that would use it. Handing a role SELECT so the role looks
 * implemented would widen the surface for nothing; the role stays unable to read until it has a
 * caller. The internal preview reads this table through the ordinary authenticated application
 * path, under the project's own RLS.
 */
export const portal = pgSchema("portal");

export const clientPublication = portal.table(
  "client_publication",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    /**
     * `1`, `2`, `3` … per project. The client's page opens the highest; an internal reviewer may
     * deliberately open an earlier one to see what the client was told last month.
     */
    sequence: integer("sequence").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull(),
    /** Who decided. A person, recorded once, and never rendered on the client's page. */
    publishedBy: uuid("published_by").notNull(),
    /** The payload's own shape version, so an old row is still renderable by a newer product. */
    schemaVersion: integer("schema_version").notNull(),
    /**
     * SHA-256 of the payload's canonical form, so "this would say exactly what v2 says" is
     * answerable without comparing two documents full of coordinates.
     */
    contentHash: text("content_hash").notNull(),
    /** Validated by `clientPublicationPayloadSchema`; the only thing the client surface reads. */
    payload: jsonb("payload").notNull(),
    /**
     * The provenance records the figures rest on.
     *
     * Kept beside the payload rather than inside it: traceability is ours and the enums are
     * internal vocabulary (ADR-027). An auditor can still ask what a published figure came from.
     */
    sourceProvenanceIds: jsonb("source_provenance_ids").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("client_publication_project_sequence_key").on(t.tenantId, t.projectId, t.sequence),
    unique("client_publication_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "client_publication_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "client_publication_published_by_fk",
      columns: [t.publishedBy],
      foreignColumns: [user.id],
    }),
  ],
);

/* ---------------------------------------------------------------------------------------------
 * The editorial presentation (Visión Ambiental, block 2)
 *
 * A second publication beside `client_publication`, and deliberately not an extension of it. That
 * one is a projection of computed figures; this one is prose people wrote. Sharing a table would
 * have meant one payload schema admitting both, and the first hand-typed number stored in a
 * projection is the moment "every figure carries a provenance id" stops being true.
 * ------------------------------------------------------------------------------------------ */

/**
 * The mutable draft. Exactly one per project, which is why `project_id` is unique here: an
 * editorial page is the page, not a list of competing attempts.
 *
 * `revision` is optimistic concurrency, not an audit trail. Two editors who open the same page and
 * both save would otherwise silently overwrite one another; the use-case refuses the second save
 * and says which revision it expected.
 */
export const editorialDraft = portal.table(
  "editorial_draft",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    revision: integer("revision").notNull().default(1),
    schemaVersion: integer("schema_version").notNull(),
    payload: jsonb("payload").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").notNull(),
  },
  (t) => [
    unique("editorial_draft_project_key").on(t.tenantId, t.projectId),
    unique("editorial_draft_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "editorial_draft_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "editorial_draft_updated_by_fk",
      columns: [t.updatedBy],
      foreignColumns: [user.id],
    }),
  ],
);

/**
 * What a visitor is served. Immutable, versioned, and carrying its own slugs.
 *
 * The slugs are denormalised on purpose. A visitor has no session, so the public read cannot join
 * `app.project` to turn a URL into an id — and giving the public branch of a policy a path into
 * the operational tables to resolve a slug is precisely the hole this surface must not have. With
 * the pair stored here, the public query touches this table and its assets and nothing else.
 */
export const editorialPublication = portal.table(
  "editorial_publication",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    tenantSlug: text("tenant_slug").notNull(),
    projectSlug: text("project_slug").notNull(),
    sequence: integer("sequence").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull(),
    publishedBy: uuid("published_by").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    contentHash: text("content_hash").notNull(),
    payload: jsonb("payload").notNull(),
  },
  (t) => [
    unique("editorial_publication_project_sequence_key").on(t.tenantId, t.projectId, t.sequence),
    unique("editorial_publication_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "editorial_publication_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "editorial_publication_published_by_fk",
      columns: [t.publishedBy],
      foreignColumns: [user.id],
    }),
  ],
);

/**
 * The attachments one publication authorises, and the only files a visitor may fetch.
 *
 * This table **is** the authorisation. A stored object is reachable publicly because a row here
 * names it for a currently-visible publication — not because it sits in a namespace, and not
 * because somebody guessed its id. Removing the publication from view removes the row's effect
 * with it, which is what makes withdrawal mean something for files as well as for text.
 */
export const editorialPublicationAsset = portal.table(
  "editorial_publication_asset",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    publicationId: uuid("publication_id").notNull(),
    storedObjectId: uuid("stored_object_id").notNull(),
    role: text("role").notNull(),
    caption: text("caption"),
    altText: text("alt_text"),
    ordinal: integer("ordinal").notNull(),
    /** Copied at publication, so a visitor's read never reaches `app.stored_object`. */
    objectKey: text("object_key").notNull(),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
  },
  (t) => [
    unique("editorial_publication_asset_unique").on(t.tenantId, t.publicationId, t.storedObjectId),
    foreignKey({
      name: "editorial_publication_asset_publication_fk",
      columns: [t.tenantId, t.publicationId],
      foreignColumns: [editorialPublication.tenantId, editorialPublication.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Published, then withdrawn, then published again. Append-only, because "was this visible on the
 * fourteenth?" is a question a consultancy's client may well ask.
 *
 * Withdrawal is an event rather than a column on the publication, so the publication row stays
 * immutable and a withdrawn version keeps its words — the same reasoning as every other
 * write-once record in this product.
 */
export const editorialVisibilityEvent = portal.table(
  "editorial_visibility_event",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    publicationId: uuid("publication_id").notNull(),
    state: text("state").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    decidedBy: uuid("decided_by").notNull(),
    reason: text("reason"),
  },
  (t) => [
    foreignKey({
      name: "editorial_visibility_event_publication_fk",
      columns: [t.tenantId, t.publicationId],
      foreignColumns: [editorialPublication.tenantId, editorialPublication.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "editorial_visibility_event_decided_by_fk",
      columns: [t.decidedBy],
      foreignColumns: [user.id],
    }),
  ],
);
