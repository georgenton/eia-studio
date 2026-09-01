import { withDbContext, type Database, type DbContext, type DbTx } from "@eia/db";
import { sql } from "drizzle-orm";

/**
 * Cross-tenant attack helpers (TESTING_STRATEGY.md §5). Each helper runs with the RUNTIME
 * connection under an explicit context and reports what the database lets through.
 */
export const RLS_VIOLATION = /row-level security policy/i;
export const INSUFFICIENT_PRIVILEGE = /permission denied/i;

export function asContext<T>(
  runtime: Database,
  ctx: DbContext,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return withDbContext(runtime, ctx, fn);
}

/** Count rows of a (schema-qualified) table visible under the context, optionally filtered. */
export async function countVisible(
  runtime: Database,
  ctx: DbContext,
  table: string,
  where?: { column: string; value: string },
): Promise<number> {
  return asContext(runtime, ctx, async (tx) => {
    const query = where
      ? sql`select count(*)::int as n from ${sql.raw(table)} where ${sql.identifier(where.column)} = ${where.value}`
      : sql`select count(*)::int as n from ${sql.raw(table)}`;
    const result = await tx.execute(query);
    const row = result.rows[0] as { n: number } | undefined;
    return row?.n ?? 0;
  });
}

/** Full error text including the PostgreSQL message (Drizzle wraps it as `cause`). */
export function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join(" <- ");
}

/** Resolve to the error text when the statement is rejected, or null when it succeeded. */
export async function attempt(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return errorText(error);
  }
}

/** Run a mutation under a context and return the number of rows it affected (0 = silently denied). */
export async function affectedRows(
  runtime: Database,
  ctx: DbContext,
  statement: ReturnType<typeof sql>,
): Promise<number> {
  return asContext(runtime, ctx, async (tx) => {
    const result = await tx.execute(statement);
    return result.rowCount ?? 0;
  });
}
