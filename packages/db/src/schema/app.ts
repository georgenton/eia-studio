import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Operational schema. Every tenant-owned table carries tenant_id; project-scoped tables carry
 * (tenant_id, project_id) with a composite FK to project so a row can never point at a project
 * of another tenant (ADR-001). RLS policies live in migrations/0002 (ADR-004).
 *
 * Role vocabularies are duplicated from @eia/domain on purpose (db must not depend on domain);
 * a domain unit test asserts both lists stay identical.
 */
export const app = pgSchema("app");

export const tenantRole = app.enum("tenant_role", ["OWNER", "ADMIN", "MEMBER"]);
export const projectRole = app.enum("project_role", [
  "COORDINATOR",
  "SOCIAL_SPECIALIST",
  "ENVIRONMENTAL_SPECIALIST",
  "GIS_SPECIALIST",
  "FIELD_TECHNICIAN",
  "REVIEWER",
  "VIEWER",
]);
export const membershipStatus = app.enum("membership_status", ["invited", "active", "suspended"]);
export const projectLifecycle = app.enum("project_lifecycle", [
  "planning",
  "field",
  "analysis",
  "review",
  "delivered",
  "closed",
]);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

/** Domain user. `id` equals the identity provider subject (ADR-010); no auth data lives here. */
export const user = app.table("user", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
});

export const tenant = app.table("tenant", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
});

export const tenantMembership = app.table(
  "tenant_membership",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: tenantRole("role").notNull(),
    status: membershipStatus("status").notNull().default("active"),
    invitedBy: uuid("invited_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("tenant_membership_tenant_user_key").on(t.tenantId, t.userId),
    // Composite target so project_membership can reference (tenant_id, id): tenant consistency.
    unique("tenant_membership_tenant_id_id_key").on(t.tenantId, t.id),
    index("tenant_membership_user_idx").on(t.userId),
  ],
);

export const project = app.table(
  "project",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    profileKey: text("profile_key").notNull(),
    profileVersion: text("profile_version").notNull(),
    lifecycle: projectLifecycle("lifecycle").notNull().default("planning"),
    /** Free-text location line shown under the project title, e.g. "Provincia, País". */
    locationLabel: text("location_label"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("project_tenant_slug_key").on(t.tenantId, t.slug),
    unique("project_tenant_id_id_key").on(t.tenantId, t.id),
  ],
);

/** Assignment of a tenant membership (never a raw user) to a project. */
export const projectMembership = app.table(
  "project_membership",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    tenantMembershipId: uuid("tenant_membership_id").notNull(),
    role: projectRole("role").notNull(),
    status: membershipStatus("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("project_membership_project_member_key").on(t.projectId, t.tenantMembershipId),
    // The composite key every tenant-scoped child FK references, so a row cannot point at a
    // membership of another tenant even if application code is wrong (ARCHITECTURE.md §5).
    unique("project_membership_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "project_membership_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "project_membership_tenant_membership_fk",
      columns: [t.tenantId, t.tenantMembershipId],
      foreignColumns: [tenantMembership.tenantId, tenantMembership.id],
    }).onDelete("cascade"),
    index("project_membership_tenant_project_idx").on(t.tenantId, t.projectId),
  ],
);

/** Tenant-level capability state: entitlement (plan/contract) + tenant toggle (FEATURES.md §4). */
export const tenantCapability = app.table(
  "tenant_capability",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    capabilityKey: text("capability_key").notNull(),
    entitled: boolean("entitled").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    changedBy: uuid("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "tenant_capability_pkey", columns: [t.tenantId, t.capabilityKey] })],
);

/** Project override: only restriction is meaningful; absence = enabled. */
export const projectCapabilitySetting = app.table(
  "project_capability_setting",
  {
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    capabilityKey: text("capability_key").notNull(),
    enabled: boolean("enabled").notNull(),
    changedBy: uuid("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "project_capability_setting_pkey",
      columns: [t.projectId, t.capabilityKey],
    }),
    foreignKey({
      name: "project_capability_setting_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/* ------------------------------------------------------------------------------------------
 * Slice 1 — project workspace, Command Center metrics and provenance.
 * Vocabularies are duplicated from @eia/domain on purpose (db must not depend on domain);
 * packages/application/test/schema-alignment asserts both lists stay identical.
 * ---------------------------------------------------------------------------------------- */

export const provenanceRegime = app.enum("provenance_regime", [
  "HISTORICAL_OBSERVED",
  "LIVE_OPERATIONAL",
  "DEMO_SIMULATION",
]);
export const provenanceOrigin = app.enum("provenance_origin", [
  "FIELD_CAPTURE",
  "IMPORTED_DOCUMENT",
  "IMPORTED_DATASET",
  "SYSTEM_GENERATED",
]);
export const provenanceTransformation = app.enum("provenance_transformation", [
  "ORIGINAL",
  "RECONSTRUCTED",
  "DERIVED",
  "ANONYMIZED",
]);
export const provenanceGranularity = app.enum("provenance_granularity", [
  "INDIVIDUAL",
  "AGGREGATE",
]);
export const provenanceValidation = app.enum("provenance_validation", [
  "VALIDATED",
  "PARTIAL",
  "PENDING",
  "NOT_REQUIRED",
  "SPECIALIST_REQUIRED",
]);

export const metricKey = app.enum("metric_key", [
  "corridor_length_km",
  "universe_estimated",
  "universe_confirmed",
  "parcels_visited",
  "surveys_complete",
  "revisits_scheduled",
  "parcels_pending",
  "productivity_per_day",
  "projected_close_date",
  "consultation_participants",
]);

export const attentionSeverity = app.enum("attention_severity", ["high", "medium", "low"]);

/**
 * Faceted provenance (ADR-005, D-013). There is deliberately no `source_type` column: the four
 * v0.2 badges are derived from the facets at render time. `transformations` is an ordered array
 * whose last element is the current transformation.
 */
export const provenanceRecord = app.table(
  "provenance_record",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    regime: provenanceRegime("regime").notNull(),
    origin: provenanceOrigin("origin").notNull(),
    transformations: provenanceTransformation("transformations").array().notNull(),
    granularity: provenanceGranularity("granularity"),
    title: text("title").notNull(),
    note: text("note").notNull(),
    sourceLabel: text("source_label"),
    sourceReference: text("source_reference"),
    sourceVersion: text("source_version"),
    method: text("method"),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    validationState: provenanceValidation("validation_state").notNull(),
    validationNote: text("validation_note"),
  },
  (t) => [
    foreignKey({
      name: "provenance_record_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    unique("provenance_record_tenant_id_id_key").on(t.tenantId, t.id),
    index("provenance_record_project_idx").on(t.tenantId, t.projectId),
  ],
);

/** Lineage edge: `provenance_id` was derived from `input_provenance_id` (ADR-005 §inputs). */
export const provenanceInput = app.table(
  "provenance_input",
  {
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    provenanceId: uuid("provenance_id").notNull(),
    inputProvenanceId: uuid("input_provenance_id").notNull(),
  },
  (t) => [
    primaryKey({
      name: "provenance_input_pkey",
      columns: [t.provenanceId, t.inputProvenanceId],
    }),
    foreignKey({
      name: "provenance_input_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "provenance_input_record_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "provenance_input_source_fk",
      columns: [t.tenantId, t.inputProvenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }).onDelete("cascade"),
  ],
);

/**
 * One measured value of one known project metric. The key is a database enum, so the table is a
 * typed measurement entity rather than a generic key/value store; `numeric_value` and
 * `date_value` are mutually exclusive by the metric's kind.
 */
export const metricSnapshot = app.table(
  "metric_snapshot",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    key: metricKey("key").notNull(),
    numericValue: numeric("numeric_value", { precision: 12, scale: 2 }),
    dateValue: date("date_value"),
    note: text("note"),
    displayOrder: integer("display_order").notNull().default(0),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    provenanceId: uuid("provenance_id").notNull(),
  },
  (t) => [
    unique("metric_snapshot_project_key_key").on(t.tenantId, t.projectId, t.key),
    foreignKey({
      name: "metric_snapshot_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "metric_snapshot_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }).onDelete("restrict"),
  ],
);

/** Deterministic operational forecast with its inputs and assumptions (invariant 5). */
export const forecastSnapshot = app.table(
  "forecast_snapshot",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    /**
     * The date the calculation is anchored to, completing the input snapshot: with it the result
     * can be recomputed from this row alone. For a DEMO_SIMULATION forecast it is also the demo
     * scenario clock (IG1-009) — the simulation's as-of date lives with the simulated
     * calculation, never on `project`, which is a real entity that knows nothing about demos.
     */
    asOfDate: date("as_of_date").notNull(),
    pending: integer("pending").notNull(),
    dailyCompletions: integer("daily_completions").array().notNull(),
    windowDays: integer("window_days").notNull(),
    movingAveragePerDay: numeric("moving_average_per_day", { precision: 8, scale: 2 }).notNull(),
    requiredRatePerDay: numeric("required_rate_per_day", { precision: 8, scale: 2 }),
    activeTechnicians: integer("active_technicians").notNull(),
    assignedTechnicians: integer("assigned_technicians").notNull(),
    targetDate: date("target_date").notNull(),
    projectedCloseDate: date("projected_close_date").notNull(),
    delayDays: integer("delay_days").notNull(),
    assumptions: text("assumptions").array().notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    provenanceId: uuid("provenance_id").notNull(),
  },
  (t) => [
    foreignKey({
      name: "forecast_snapshot_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "forecast_snapshot_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }).onDelete("restrict"),
    index("forecast_snapshot_project_idx").on(t.tenantId, t.projectId, t.calculatedAt),
  ],
);

/** "Requiere atención hoy": a curated queue, not a rule engine. */
export const attentionItem = app.table(
  "attention_item",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    severity: attentionSeverity("severity").notNull(),
    title: text("title").notNull(),
    note: text("note"),
    surfaceLabel: text("surface_label").notNull(),
    surfaceKey: text("surface_key"),
    actionLabel: text("action_label"),
    displayOrder: integer("display_order").notNull().default(0),
    provenanceId: uuid("provenance_id").notNull(),
  },
  (t) => [
    foreignKey({
      name: "attention_item_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "attention_item_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }).onDelete("restrict"),
    index("attention_item_project_idx").on(t.tenantId, t.projectId, t.displayOrder),
  ],
);

/** Recent activity feed. Actor is a display label, never a personal identifier. */
export const activityEvent = app.table(
  "activity_event",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    objectLabel: text("object_label"),
    provenanceId: uuid("provenance_id").notNull(),
  },
  (t) => [
    foreignKey({
      name: "activity_event_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "activity_event_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }).onDelete("restrict"),
    index("activity_event_project_idx").on(t.tenantId, t.projectId, t.occurredAt),
  ],
);
