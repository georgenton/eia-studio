import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { schema } from "./schema/index";

export interface PoolOptions {
  readonly max?: number;
  readonly applicationName?: string;
  /**
   * How long a statement may run before the server cancels it, in milliseconds; `null` disables it.
   *
   * It makes nothing faster. It makes a stuck query fail, legibly, instead of holding a connection
   * until something else times out (TD-067). Operator work — migrations, seeds, imports, test
   * fixtures — passes `null`, because a migration cancelled halfway is worse than a slow one.
   */
  readonly statementTimeoutMs?: number | null;
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
  /*
   * Connection settings, chosen from one observed failure rather than from a checklist.
   *
   * A manual review of the Preview saw a single `read ECONNRESET` on a session query. The functions
   * and the database are in different regions and the path runs through a public TCP proxy, which
   * is the shape of failure where an idle connection is dropped by something in the middle and the
   * pool then hands it to a request as though it were healthy (`docs/PERFORMANCE_BASELINE.md` §6).
   *
   * So: **keepalive**, so the path is never idle long enough to be reclaimed silently; a **bounded
   * lifetime** and a shorter **idle timeout**, so a connection is recycled by us rather than by a
   * middlebox; and a **connect timeout**, so a request that cannot get a connection fails in
   * seconds with a legible error instead of hanging (TD-067).
   *
   * Deliberately *not* here: retries. A retry around a transaction re-runs whatever it contained,
   * and this product's transactions write. The pool already discards a client that errored, so the
   * next request gets a fresh connection; making the failing one fail clearly is the honest fix.
   */
  const statementTimeoutMs =
    options.statementTimeoutMs === undefined ? 20_000 : options.statementTimeoutMs;

  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? "eia-studio",
    /*
     * Sent with the startup packet rather than as a `set` on connect. A fire-and-forget `set`
     * races with the first query the caller sends on the same client — pg warns about exactly
     * that — and costs a round trip on every new connection. This costs none and cannot race.
     */
    ...(statementTimeoutMs === null
      ? {}
      : { options: `-c statement_timeout=${Math.trunc(statementTimeoutMs)}` }),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    idleTimeoutMillis: 30_000,
    maxLifetimeSeconds: 600,
    connectionTimeoutMillis: 10_000,
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
