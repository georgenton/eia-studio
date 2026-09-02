import { createDatabase, createPool, withDbContext } from "@eia/db";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getTestDatabase } from "../src/index";

const db = getTestDatabase();
afterAll(() => db.close());

async function readSettings(tx: Parameters<Parameters<typeof withDbContext>[2]>[0]) {
  const r = await tx.execute(sql`
    select current_setting('app.user_id', true) as u, current_setting('app.tenant_id', true) as t,
           current_setting('app.project_id', true) as p, app.current_tenant_id() as tenant_uuid
  `);
  return r.rows[0] as {
    u: string | null;
    t: string | null;
    p: string | null;
    tenant_uuid: string | null;
  };
}

describe("request-local database context (ADR-004)", () => {
  it("settings are transaction-local and do not leak on a reused connection", async () => {
    // A single-connection pool guarantees the same physical connection is reused.
    const pool = createPool(db.info.runtimeUrl, { max: 1 });
    const single = createDatabase(pool);
    const tenantA = "11111111-1111-4111-8111-111111111111";
    const tenantB = "22222222-2222-4222-8222-222222222222";
    try {
      const first = await withDbContext(
        single,
        { userId: null, tenantId: tenantA, projectId: null },
        readSettings,
      );
      expect(first.t).toBe(tenantA);
      expect(first.tenant_uuid).toBe(tenantA);

      const outside = await single.execute(sql`select current_setting('app.tenant_id', true) as t`);
      expect((outside.rows[0] as { t: string | null }).t ?? "").toBe("");

      const second = await withDbContext(
        single,
        { userId: null, tenantId: tenantB, projectId: null },
        readSettings,
      );
      expect(second.t).toBe(tenantB);

      const none = await withDbContext(
        single,
        { userId: null, tenantId: null, projectId: null },
        readSettings,
      );
      expect(none.tenant_uuid).toBeNull();
      expect(none.t).toBe("");
    } finally {
      await pool.end();
    }
  });

  it("rejects non-UUID identifiers before touching the database", async () => {
    await expect(
      withDbContext(
        db.runtime,
        { userId: "1 or 1=1", tenantId: null, projectId: null },
        async () => 1,
      ),
    ).rejects.toThrow(/must be a UUID/);
  });
});
