import { createDatabase, createPool, type Database, type DbTx, type Pool } from "@eia/db";
import { sql } from "drizzle-orm";
import { inject } from "vitest";

import { EPHEMERAL_MARKER_SCHEMA } from "./ephemeral-guard";
import type { EiaStagingDatabase } from "./staging-setup";

/**
 * Connections for the non-destructive staging suite.
 *
 * Two of them, for the same reason the integration fixture has two: the migrator connection reads
 * catalogues (policies, triggers, the migration ledger) that the runtime role deliberately cannot
 * see, and the runtime connection is the one under test when the subject is isolation — asserting
 * RLS through a superuser proves nothing.
 *
 * Nothing here truncates, drops or resets. The only writes the suite performs are inside
 * transactions that are always rolled back (`rollbackProbe`).
 */
export interface StagingDatabase {
  readonly info: EiaStagingDatabase;
  readonly migratorPool: Pool;
  readonly migrator: Database;
  readonly runtimePool: Pool;
  readonly runtime: Database;
  readonly close: () => Promise<void>;
}

let cached: StagingDatabase | null = null;

export function getStagingDatabase(): StagingDatabase {
  if (cached) return cached;
  const info = inject("eiaStagingDatabase");
  const migratorPool = createPool(info.migratorUrl, {
    max: 2,
    applicationName: "eia-staging-verify-migrator",
  });
  const runtimePool = createPool(info.runtimeUrl, {
    max: 2,
    applicationName: "eia-staging-verify-runtime",
  });
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

class RollbackSentinel extends Error {
  override readonly name = "RollbackSentinel";
}

export interface ProbeOutcome {
  /** The PostgreSQL error text when the statement was refused, or null when it went through. */
  readonly error: string | null;
}

/**
 * Run one small mutation against the persistent environment and undo it unconditionally.
 *
 * Some contracts can only be observed by attempting the thing they forbid — that a published
 * questionnaire refuses an edit, that a submitted response refuses a new answer. Verifying those
 * on staging must not leave a test questionnaire, a test answer or a half-applied change behind,
 * so every probe runs inside a transaction that ends in ROLLBACK whichever way the statement goes:
 * a refused statement aborts the transaction, and an accepted one is thrown away by the sentinel.
 *
 * A probe that *succeeds* is therefore still invisible afterwards; a probe that fails is the
 * assertion. Either way the environment is untouched, which is the whole point of this suite.
 */
export async function rollbackProbe(
  db: Database,
  fn: (tx: DbTx) => Promise<unknown>,
): Promise<ProbeOutcome> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSentinel("probe complete; rolling back");
    });
    /* c8 ignore next 2 -- the transaction above always throws */
    return { error: null };
  } catch (error) {
    if (isSentinel(error)) return { error: null };
    return { error: errorChain(error) };
  }
}

function isSentinel(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof RollbackSentinel) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

function errorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join(" <- ");
}

/**
 * A persistent environment must never carry the ephemeral marker: if it did, a destructive helper
 * pointed at it would proceed. Asserted here so the two halves of the split are checked from both
 * sides rather than only from the side that does the damage.
 */
export async function assertNotStampedEphemeral(db: Database): Promise<void> {
  const result = await db.execute(sql`
    select count(*)::int as n from information_schema.schemata
    where schema_name = ${EPHEMERAL_MARKER_SCHEMA}
  `);
  const found = (result.rows[0] as { n: number }).n;
  if (found > 0) {
    throw new Error(
      `this database carries the ${EPHEMERAL_MARKER_SCHEMA} marker schema, which only the ` +
        `throwaway test container should have. Refusing to treat it as a persistent environment.`,
    );
  }
}
