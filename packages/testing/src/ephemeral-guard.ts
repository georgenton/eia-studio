import { sql } from "drizzle-orm";

import type { Database } from "@eia/db";

/**
 * The line between a database tests may destroy and a database they may not.
 *
 * The integration suite starts each file from a known world, which means truncating tenants,
 * projects and identities. That is correct for a container that exists for the length of one run
 * and catastrophic for a persistent environment: pointed at staging, the same helper removed the
 * synthetic identities the demo campaign assigns work to, and the next re-seed produced a campaign
 * with zero assignments (IG3-001).
 *
 * The fix is not "remember not to do that". It is that a destructive helper must be *unable* to
 * run anywhere but an ephemeral database, and must fail closed when it cannot prove otherwise.
 *
 * **How an ephemeral database is identified.** Not by hostname, not by database name, not by
 * `NODE_ENV`, and not by the absence of a "this is production" flag — every one of those is a
 * guess that a forgotten environment variable turns into a wiped environment. Instead the fixture
 * that *creates* the throwaway container stamps it, inside the same setup that started it, with a
 * marker table holding a token generated in that process:
 *
 *   `ephemeral_test.marker (token)` — one row, a fresh random token per run.
 *
 * A destructive helper then requires that the marker exists *and* that its token equals the one
 * this run generated. A persistent database has no marker, because nothing but the container setup
 * ever writes one; and even a copied marker fails, because the token is new every run and never
 * leaves the process. Missing schema, missing table, missing row, extra rows and mismatched token
 * all take the same path: refuse.
 *
 * The marker lives in its own schema rather than in `app`, so it is not tenant data, carries no
 * RLS question, and cannot be reached by the runtime role.
 */
export const EPHEMERAL_MARKER_SCHEMA = "ephemeral_test";

export class NotAnEphemeralDatabase extends Error {
  override readonly name = "NotAnEphemeralDatabase";
  constructor(reason: string) {
    super(
      `refusing a destructive test operation: ${reason}. Destructive integration tests run only ` +
        `against the Testcontainers database created by packages/testing/src/global-setup.ts. ` +
        `To verify a persistent environment, use the non-destructive staging suite ` +
        `(pnpm test:staging).`,
    );
  }
}

/**
 * Stamp a freshly created throwaway database. Called only by the Testcontainers setup, with the
 * migrator connection, immediately after migrations.
 */
export async function stampEphemeralTestDatabase(db: Database, token: string): Promise<void> {
  if (!/^[0-9a-f]{32,}$/.test(token)) {
    throw new Error("ephemeral marker token must be at least 32 hex characters");
  }
  await db.execute(sql`create schema if not exists ${sql.identifier(EPHEMERAL_MARKER_SCHEMA)}`);
  await db.execute(sql`
    create table if not exists ${sql.identifier(EPHEMERAL_MARKER_SCHEMA)}.marker (
      token text primary key,
      stamped_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`delete from ${sql.identifier(EPHEMERAL_MARKER_SCHEMA)}.marker`);
  await db.execute(
    sql`insert into ${sql.identifier(EPHEMERAL_MARKER_SCHEMA)}.marker (token) values (${token})`,
  );
}

/**
 * Verify that this connection is the throwaway database of this run, or throw.
 *
 * Every failure mode — the schema is absent, the table is absent, the row count is not one, the
 * token differs, the query errors for any reason at all — refuses. There is no argument, flag or
 * environment variable that makes this pass on a database that was not stamped.
 */
export async function assertEphemeralTestDatabase(db: Database, token: string): Promise<void> {
  let rows: ReadonlyArray<{ token: string }>;
  try {
    const result = await db.execute(sql`
      select token from ${sql.identifier(EPHEMERAL_MARKER_SCHEMA)}.marker
    `);
    rows = result.rows as unknown as ReadonlyArray<{ token: string }>;
  } catch {
    // An unstamped database has no such schema, and that is the common case this guard exists
    // for. The original error text is deliberately not surfaced: it can carry the connection's
    // database name, and the answer is the same whatever it says.
    throw new NotAnEphemeralDatabase(
      `no ${EPHEMERAL_MARKER_SCHEMA}.marker table — this database was not created by the test fixture`,
    );
  }

  if (rows.length !== 1) {
    throw new NotAnEphemeralDatabase(
      `${EPHEMERAL_MARKER_SCHEMA}.marker holds ${rows.length} rows, expected exactly one`,
    );
  }
  if (rows[0]!.token !== token) {
    throw new NotAnEphemeralDatabase(
      "the ephemeral marker was written by a different run; a copied marker does not authorise a reset",
    );
  }
}
