import { sql } from "drizzle-orm";

import type { Database, DbTx } from "./client";

/**
 * Request-local database context (ADR-004). Every unit of work runs inside a transaction whose
 * first statement sets `app.user_id`, `app.tenant_id`, `app.project_id`, `app.surface` with
 * `set_config(..., true)` — transaction-local, so nothing leaks across pooled connections.
 * Absent values are set to '' which the SQL helpers read as NULL; policies then deny by default.
 */
export interface DbContext {
  readonly userId: string | null;
  readonly tenantId: string | null;
  readonly projectId: string | null;
  readonly surface?: "internal" | "job";
  /**
   * Whether this unit of work may see field responses that are not the caller's own.
   *
   * Set from `field.responses.read` by the application layer, never inferred here: `packages/db`
   * has no idea what a permission is, and must not acquire one. Default `false`, so a caller that
   * forgets it sees only its own rows — the safe direction (SECURITY.md §5, same shape as
   * `app.pii_access`).
   */
  readonly fieldResponsesAccess?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrEmpty(value: string | null, name: string): string {
  if (value === null) return "";
  if (!UUID.test(value)) throw new Error(`db context: ${name} must be a UUID`);
  return value;
}

export async function withDbContext<T>(
  db: Database,
  ctx: DbContext,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  const userId = uuidOrEmpty(ctx.userId, "userId");
  const tenantId = uuidOrEmpty(ctx.tenantId, "tenantId");
  const projectId = uuidOrEmpty(ctx.projectId, "projectId");
  const surface = ctx.surface ?? "internal";
  const fieldResponses = ctx.fieldResponsesAccess === true ? "on" : "off";
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.user_id', ${userId}, true),
                 set_config('app.tenant_id', ${tenantId}, true),
                 set_config('app.project_id', ${projectId}, true),
                 set_config('app.surface', ${surface}, true),
                 set_config('app.field_responses_access', ${fieldResponses}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Adopt a tenant on a transaction that started without one.
 *
 * There is exactly one legitimate caller: the authorization path. It must resolve *which* tenant
 * the caller belongs to before it may claim one, so its first statements run with `app.tenant_id`
 * unset and everything after them runs with the tenant it just proved. Splitting those two phases
 * into two transactions costs a `BEGIN`, a `set_config` and a `COMMIT` to express an ordering that
 * `SET LOCAL` already expresses inside one (TD-064).
 *
 * The settings stay transaction-local, so nothing leaks onto the pooled connection, and the
 * envelope of each statement is unchanged: the membership lookup still runs tenant-less, and the
 * project reads still run under the tenant. What disappears is the framing, not a boundary.
 *
 * It only ever *narrows* — a tenant is adopted once, and `app.project_id` is left unset for the
 * project policies to decide. Anything else belongs in its own `withDbContext`.
 */
export async function adoptTenantContext(
  tx: DbTx,
  ctx: { readonly userId: string; readonly tenantId: string },
): Promise<void> {
  const userId = uuidOrEmpty(ctx.userId, "userId");
  const tenantId = uuidOrEmpty(ctx.tenantId, "tenantId");
  await tx.execute(
    sql`select set_config('app.user_id', ${userId}, true),
               set_config('app.tenant_id', ${tenantId}, true)`,
  );
}

/** Explicitly context-less transaction (e.g. identity-provider tables): policies deny app.* rows. */
export async function withoutDbContext<T>(db: Database, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return withDbContext(db, { userId: null, tenantId: null, projectId: null }, fn);
}
