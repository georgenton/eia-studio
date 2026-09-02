import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createPool } from "./client";

export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
export const MIGRATIONS_SCHEMA = "drizzle";

/**
 * Apply all pending migrations with the migrator role (DATABASE_MIGRATOR_URL). Never called with
 * the runtime role: the runtime role has no DDL privileges, so it would fail (ADR-004).
 */
export async function runMigrations(migratorUrl: string): Promise<void> {
  const pool = createPool(migratorUrl, { max: 1, applicationName: "eia-studio-migrate" });
  try {
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER, migrationsSchema: MIGRATIONS_SCHEMA });
  } finally {
    await pool.end();
  }
}
