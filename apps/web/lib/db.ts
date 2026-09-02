import "server-only";

import { createDatabase, createPool, type Database } from "@eia/db";

import { getEnv } from "./env";

// One pool per process (Next.js dev reloads modules; keep it on globalThis).
const globalRef = globalThis as unknown as { __eiaDb?: Database };

/** Runtime database (RLS-enforced role). Never the migrator connection. */
export function getDb(): Database {
  if (!globalRef.__eiaDb) {
    const env = getEnv();
    globalRef.__eiaDb = createDatabase(
      createPool(env.database.DATABASE_URL, { applicationName: "eia-studio-web" }),
    );
  }
  return globalRef.__eiaDb;
}
