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
    /** Identity of the content, so "this would say exactly what v2 says" is answerable. */
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
