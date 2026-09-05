import { createDatabase, createPool, type Database, type Pool } from "@eia/db";
import { sql } from "drizzle-orm";
import { inject } from "vitest";

import { assertEphemeralTestDatabase } from "./ephemeral-guard";
import type { EiaTestDatabase } from "./global-setup";

export interface TestDatabase {
  readonly info: EiaTestDatabase;
  /** Superuser/owner connection: seeds fixtures and inspects catalogs. Bypasses RLS. */
  readonly migratorPool: Pool;
  readonly migrator: Database;
  /** Runtime connection: the role the applications use. RLS enforced. */
  readonly runtimePool: Pool;
  readonly runtime: Database;
  readonly close: () => Promise<void>;
}

let cached: TestDatabase | null = null;

export function getTestDatabase(): TestDatabase {
  if (cached) return cached;
  const info = inject("eiaTestDatabase");
  // Resets and fixture builds are long by nature; the request-shaped timeout is for requests.
  const migratorPool = createPool(info.migratorUrl, {
    statementTimeoutMs: null,
    max: 4,
    applicationName: "eia-test-migrator",
  });
  const runtimePool = createPool(info.runtimeUrl, { max: 4, applicationName: "eia-test-runtime" });
  cached = {
    info,
    migratorPool,
    migrator: createDatabase(migratorPool),
    runtimePool,
    runtime: createDatabase(runtimePool),
    close: async () => {
      await migratorPool.end();
      await runtimePool.end();
      cached = null;
    },
  };
  return cached;
}

/**
 * Remove all rows from tenant-owned and identity tables between test files.
 *
 * Destructive by design, and therefore guarded: it verifies the ephemeral marker written by the
 * Testcontainers setup before it truncates anything, and refuses otherwise (IG3-001). The check
 * costs one query per test file and makes "this suite wiped staging" a failure at the first
 * statement instead of a discovery afterwards.
 */
export async function resetDatabase(db: Database): Promise<void> {
  await assertEphemeralTestDatabase(db, inject("eiaTestDatabase").ephemeralToken);
  await db.execute(sql`
    truncate table
      audit.log,
      app.project_capability_setting,
      app.project_membership,
      app.project,
      app.tenant_capability,
      app.tenant_membership,
      app.tenant,
      app."user",
      auth.verification,
      auth.account,
      auth.session,
      auth."user"
    restart identity cascade
  `);
}
