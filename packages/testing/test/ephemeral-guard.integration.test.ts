import { createDatabase, createPool } from "@eia/db";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  assertEphemeralTestDatabase,
  EPHEMERAL_MARKER_SCHEMA,
  getTestDatabase,
  NotAnEphemeralDatabase,
  resetDatabase,
} from "../src/index";

/**
 * The guard that stands between the destructive suite and a persistent environment (IG3-001).
 *
 * The failure being tested for is not hypothetical: the integration suite was pointed at staging,
 * truncated its tenants and identities, and left the demo campaign with no technicians to assign
 * work to. The rule now is that a destructive helper must *prove* it is talking to the throwaway
 * container this run created, and refuse otherwise — so the interesting assertions here are the
 * refusals.
 */
const db = getTestDatabase();
afterAll(() => db.close());

describe("the ephemeral-database marker", () => {
  it("is stamped on the container this run created", async () => {
    const result = await db.migrator.execute(sql`
      select token from ${sql.identifier(EPHEMERAL_MARKER_SCHEMA)}.marker
    `);
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0] as { token: string }).token).toBe(db.info.ephemeralToken);
  });

  it("accepts this run's token", async () => {
    await expect(
      assertEphemeralTestDatabase(db.migrator, db.info.ephemeralToken),
    ).resolves.toBeUndefined();
  });

  it("refuses a token from another run, even though the marker exists", async () => {
    // A copied marker table is not authorisation: the token is generated per run and never
    // written outside the process that created the container.
    await expect(assertEphemeralTestDatabase(db.migrator, "f".repeat(48))).rejects.toBeInstanceOf(
      NotAnEphemeralDatabase,
    );
  });

  it("refuses a database that was never stamped", async () => {
    // The maintenance database on the same server, reached with the same credentials: everything
    // a hostname or environment heuristic would look at is identical, and only the marker differs
    // — which is the whole point of identifying ephemerality this way.
    const url = new URL(db.info.migratorUrl);
    url.pathname = "/postgres";
    const pool = createPool(url.toString(), { max: 1, applicationName: "eia-test-guard" });
    try {
      await expect(
        assertEphemeralTestDatabase(createDatabase(pool), db.info.ephemeralToken),
      ).rejects.toBeInstanceOf(NotAnEphemeralDatabase);
    } finally {
      await pool.end();
    }
  });

  it("its message points at the non-destructive suite instead of a way around it", async () => {
    let message = "";
    try {
      await assertEphemeralTestDatabase(db.migrator, "0".repeat(48));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("pnpm test:staging");
    // No flag, no override, no environment variable is offered — because none exists.
    expect(message).not.toMatch(/set [A-Z_]+=|--force/);
  });

  it("resetDatabase runs on the stamped container", async () => {
    // The positive case, so the guard is not passing merely by refusing everything.
    await expect(resetDatabase(db.migrator)).resolves.toBeUndefined();
  });

  it("the runtime role cannot read or write the marker", async () => {
    // It is tooling state, not tenant data: the application role has no business seeing it, and
    // could not forge one if it tried.
    const readable = await db.runtime
      .execute(sql`select token from ${sql.identifier(EPHEMERAL_MARKER_SCHEMA)}.marker`)
      .then(() => true)
      .catch(() => false);
    expect(readable).toBe(false);
  });
});
