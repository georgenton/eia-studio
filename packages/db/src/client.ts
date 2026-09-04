import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { schema } from "./schema/index";

export interface PoolOptions {
  readonly max?: number;
  readonly applicationName?: string;
  /**
   * Called after every statement, with how long the round trip took.
   *
   * The performance baseline needs to know how many times a page talks to the database and what
   * each exchange costs, and the honest place to count that is the driver — a count kept by the
   * application would miss whatever the ORM does on its own. It receives a duration and nothing
   * else: no SQL text and no parameters, because parameters carry survey answers.
   */
  readonly onQuery?: (durationMs: number) => void;
}

export function createPool(connectionString: string, options: PoolOptions = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? "eia-studio",
  });
  const { onQuery } = options;
  if (onQuery) {
    // Wrapping the client rather than the pool: every use-case runs inside a transaction, and a
    // transaction's statements go to a checked-out client, so `pool.query` would see almost none
    // of the traffic that matters.
    pool.on("connect", (client) => {
      const original = client.query.bind(client) as (...args: unknown[]) => unknown;
      const counted = (...args: unknown[]): unknown => {
        const started = performance.now();
        const result = original(...args);
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          void (result as Promise<unknown>).then(
            () => onQuery(performance.now() - started),
            () => onQuery(performance.now() - started),
          );
        } else {
          onQuery(performance.now() - started);
        }
        return result;
      };
      (client as unknown as { query: unknown }).query = counted;
    });
  }
  return pool;
}

export function createDatabase(pool: pg.Pool) {
  return drizzle({ client: pool, schema });
}

export type Database = ReturnType<typeof createDatabase>;
export type DbTx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type { Pool } from "pg";
