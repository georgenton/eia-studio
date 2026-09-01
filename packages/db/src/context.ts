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
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.user_id', ${userId}, true),
                 set_config('app.tenant_id', ${tenantId}, true),
                 set_config('app.project_id', ${projectId}, true),
                 set_config('app.surface', ${surface}, true)`,
    );
    return fn(tx);
  });
}

/** Explicitly context-less transaction (e.g. identity-provider tables): policies deny app.* rows. */
export async function withoutDbContext<T>(db: Database, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return withDbContext(db, { userId: null, tenantId: null, projectId: null }, fn);
}
