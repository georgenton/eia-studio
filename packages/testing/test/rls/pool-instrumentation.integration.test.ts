import { createDatabase, createPool } from "@eia/db";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getTestDatabase } from "../../src/index";

/**
 * The performance baseline's counting hook (`docs/PERFORMANCE_BASELINE.md` §2).
 *
 * Worth testing rather than trusting, for one reason: a counter that silently sees nothing reports
 * zero, and zero round trips is indistinguishable from a page that touched no database. That is
 * exactly what happened the first time this was wired up, and a measurement nobody can tell apart
 * from a broken measurement is worse than none.
 *
 * The second test is the privacy contract. The hook is handed a duration and nothing else — no SQL
 * text and no parameters — because a query's parameters carry survey answers.
 */
const db = getTestDatabase();
const pools: Array<{ end: () => Promise<void> }> = [];

afterAll(async () => {
  for (const pool of pools) await pool.end();
});

describe("the pool's query hook", () => {
  it("counts statements inside a transaction, which is where nearly all of them are", async () => {
    const seen: number[] = [];
    const pool = createPool(db.info.runtimeUrl, {
      max: 1,
      applicationName: "eia-test-perf-hook",
      onQuery: (durationMs) => seen.push(durationMs),
    });
    pools.push(pool);
    const instrumented = createDatabase(pool);

    await instrumented.execute(sql`select 1`);
    const outsideTransaction = seen.length;
    expect(outsideTransaction).toBeGreaterThan(0);

    await instrumented.transaction(async (tx) => {
      await tx.execute(sql`select 2`);
      await tx.execute(sql`select 3`);
    });

    // BEGIN, two statements and COMMIT: the framing is counted too, and deliberately, because it
    // is a real round trip and finding 2 of the baseline is entirely about how many there are.
    expect(seen.length - outsideTransaction).toBeGreaterThanOrEqual(4);
    for (const duration of seen) expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("is given a duration and nothing else", async () => {
    const arguments_: unknown[][] = [];
    const pool = createPool(db.info.runtimeUrl, {
      max: 1,
      applicationName: "eia-test-perf-args",
      onQuery: (...args: unknown[]) => arguments_.push(args),
    });
    pools.push(pool);

    await createDatabase(pool).execute(sql`select ${"un texto que nadie debe registrar"}::text`);

    expect(arguments_.length).toBeGreaterThan(0);
    for (const args of arguments_) {
      expect(args).toHaveLength(1);
      expect(typeof args[0]).toBe("number");
    }
  });

  it("a pool without the hook behaves exactly as before", async () => {
    const pool = createPool(db.info.runtimeUrl, { max: 1, applicationName: "eia-test-perf-none" });
    pools.push(pool);
    const result = await createDatabase(pool).execute(sql`select 42 as answer`);
    expect((result.rows[0] as { answer: number }).answer).toBe(42);
  });
});
