import { DatabaseSync } from "node:sqlite";
import type * as SQLite from "expo-sqlite";

/*
 * `node:sqlite` arrived in Node 22 and this repository requires Node 24 (`engines` in the root
 * manifest), so needing it is not a new constraint — but it is the first test that *notices*,
 * and an unexplained `Cannot find module 'node:sqlite'` from a pre-push hook sends somebody
 * looking at the wrong thing. This says which thing.
 */
if (typeof DatabaseSync !== "function") {
  throw new Error(
    "apps/field/test/support/local-db.ts needs node:sqlite, which arrives in Node 22. " +
      "This repository requires Node 24 — run `nvm use` before the test suite.",
  );
}

import { LOCAL_MIGRATIONS } from "../../src/db/migrations";

/**
 * A real SQLite database for the device's repository, in this process.
 *
 * ## Why this exists rather than a mock
 *
 * The things worth testing about the local journal are its **constraints**: that
 * `insert or ignore` on a `local_id` makes a retry one row, that the migration adds tables
 * without dropping anything, that a failed transaction rolls back and leaves the previous
 * project whole. A mock of `expo-sqlite` would be a mock of exactly the component those
 * properties live in — it would pass whatever it was written to pass.
 *
 * `node:sqlite` is the same engine the device runs (SQLCipher is SQLite plus encryption, and
 * encryption is not what these tests are about — `open.ts` verifies that on the handset, where
 * it can). The adapter below is deliberately thin: it maps the five methods the repository
 * actually calls onto the synchronous API and does nothing else.
 *
 * What this cannot test is the handset: permissions, the camera, the file system, a real
 * force-stop. Those remain the emulator's job and are not claimed here.
 */
export interface LocalTestDatabase {
  /**
   * Typed as the handle the repository takes. It is a real SQLite behind the five methods the
   * repository calls and a cast for the twenty-five it does not — asserted rather than
   * implemented, because implementing `nativeDatabase` to satisfy a compiler would be a lie
   * with more code in it.
   */
  readonly db: SQLite.SQLiteDatabase;
  /** The raw handle, so a test can apply the migrations an older device has not run. */
  readonly raw: DatabaseSync;
  close(): void;
}

/** The subset of `SQLite.SQLiteDatabase` the repository uses, and nothing more. */
export interface FakeSQLiteDatabase {
  runAsync(sql: string, ...params: unknown[]): Promise<void>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  withTransactionAsync(fn: () => Promise<void>): Promise<void>;
  execAsync(sql: string): Promise<void>;
}

function adapt(handle: DatabaseSync): FakeSQLiteDatabase {
  const bind = (params: unknown[]) =>
    params.map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : value)) as never[];
  return {
    async runAsync(sql, ...params) {
      handle.prepare(sql).run(...bind(params));
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]) {
      return handle.prepare(sql).all(...bind(params)) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]) {
      return (handle.prepare(sql).get(...bind(params)) as T | undefined) ?? null;
    },
    /**
     * A real transaction, so a rollback is a rollback.
     *
     * This is the method the atomic project switch rests on: the test that forces a failure
     * halfway through would prove nothing against a wrapper that simply ran the callback.
     */
    async withTransactionAsync(fn) {
      handle.exec("BEGIN");
      try {
        await fn();
        handle.exec("COMMIT");
      } catch (error) {
        handle.exec("ROLLBACK");
        throw error;
      }
    },
    async execAsync(sql) {
      handle.exec(sql);
    },
  };
}

/** An empty device, migrated to the current local schema. */
export function openTestDatabase(): LocalTestDatabase {
  const handle = new DatabaseSync(":memory:");
  handle.exec("PRAGMA foreign_keys = ON");
  for (const migration of LOCAL_MIGRATIONS) {
    for (const statement of migration.statements) handle.exec(statement);
  }
  return { db: asDatabase(adapt(handle)), raw: handle, close: () => handle.close() };
}

/**
 * A device that stopped at an older schema version, so an upgrade can be observed.
 *
 * Used by the test that asserts a handset holding v3 work keeps its drafts, its outbox and its
 * photographs through the update — which is the one property migration 4 had to satisfy.
 */
export function openTestDatabaseAtVersion(version: number): LocalTestDatabase {
  const handle = new DatabaseSync(":memory:");
  handle.exec("PRAGMA foreign_keys = ON");
  for (const migration of LOCAL_MIGRATIONS.filter((m) => m.version <= version)) {
    for (const statement of migration.statements) handle.exec(statement);
  }
  return { db: asDatabase(adapt(handle)), raw: handle, close: () => handle.close() };
}

/** Apply the migrations a device at `from` has not run yet, the way the application does. */
export function upgrade(database: LocalTestDatabase, from: number): void {
  for (const migration of LOCAL_MIGRATIONS.filter((m) => m.version > from)) {
    for (const statement of migration.statements) database.raw.exec(statement);
  }
}

/** See `LocalTestDatabase.db`. One cast, in one place, with the reason beside it. */
function asDatabase(fake: FakeSQLiteDatabase): SQLite.SQLiteDatabase {
  return fake as unknown as SQLite.SQLiteDatabase;
}

/**
 * A new adapter over the same database file.
 *
 * Stands in for *the application was killed and started again*: nothing of the previous process
 * is carried over except what SQLite persisted. It cannot simulate a real force-stop — that
 * needs a device — but it does fail if anything the screens rely on had been kept in memory.
 */
export function asFreshHandle(raw: DatabaseSync): SQLite.SQLiteDatabase {
  return asDatabase(adapt(raw));
}
