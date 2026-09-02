import { sql } from "drizzle-orm";
import { index, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { tenant } from "./app";

/** Append-only security audit (SECURITY.md §9). No UPDATE/DELETE grants for the runtime role. */
export const audit = pgSchema("audit");

export const log = audit.table(
  "log",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "restrict" }),
    projectId: uuid("project_id"),
    actorUserId: uuid("actor_user_id"),
    actorKind: text("actor_kind").notNull(),
    action: text("action").notNull(),
    objectKind: text("object_kind").notNull(),
    objectId: text("object_id"),
    reason: text("reason"),
    requestId: text("request_id"),
    details: jsonb("details").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("audit_log_tenant_time_idx").on(t.tenantId, t.occurredAt)],
);
