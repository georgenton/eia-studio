import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
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
