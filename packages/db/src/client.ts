import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { schema } from "./schema/index";

export interface PoolOptions {
  readonly max?: number;
  readonly applicationName?: string;
}

export function createPool(connectionString: string, options: PoolOptions = {}): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? "eia-studio",
  });
}

export function createDatabase(pool: pg.Pool) {
  return drizzle({ client: pool, schema });
}

export type Database = ReturnType<typeof createDatabase>;
export type DbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type { Pool } from "pg";
