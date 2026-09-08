import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asContext,
  attempt,
  countVisible,
  createProjectMembership,
  createProvenanceRecord,
  getTestDatabase,
  INSUFFICIENT_PRIVILEGE,
  resetDatabase,
  RLS_VIOLATION,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * The client portal's projection: isolation, immutability, and the role that is deliberately not
 * connected yet (ADR-009, ADR-027).
 *
 * A publication is destined for somebody outside the firm, which is exactly why it is not outside
 * the isolation model. It is tenant data with a plan to leave, and until the grant and session
 * model exist the only thing that can read it is an authenticated internal caller under the
 * project's own predicate.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let provA: string;
let provB: string;

const ctxA = (projectId: string | null = null) => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId: projectId ?? w.projectX.id,
});
const ctxB = () => ({
  userId: w.ownerB.id,
  tenantId: w.tenantB.id,
  projectId: w.projectZ.id,
});

const PAYLOAD = {
  schemaVersion: 1,
  project: { name: "Proyecto", officialTitle: null, locality: "Cantón", programmeReference: null },
};

async function insertPublication(
  ctx: { userId: string; tenantId: string; projectId: string },
  sequence: number,
): Promise<string> {
  const id = randomUUID();
  await asContext(db.runtime, ctx, async (tx) => {
    await tx.execute(sql`
      insert into portal.client_publication
        (id, tenant_id, project_id, sequence, published_at, published_by, schema_version,
         content_hash, payload, source_provenance_ids)
      values (${id}, ${ctx.tenantId}, ${ctx.projectId}, ${sequence}, now(), ${ctx.userId}, 1,
              ${`hash-${sequence}`}, ${JSON.stringify(PAYLOAD)}::jsonb, ${"[]"}::jsonb)
    `);
  });
  return id;
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  // The owner of tenant B works on its project explicitly: the OWNER's implicit access is an
  // application-layer computation, and this file is about what the database enforces.
  await createProjectMembership(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    tenantMembershipId: w.ownerB.membershipId,
    role: "COORDINATOR",
  });
  provA = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "HISTORICAL_OBSERVED",
    })
  ).id;
  provB = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantB.id,
      projectId: w.projectZ.id,
      regime: "HISTORICAL_OBSERVED",
    })
  ).id;
  expect(provA).not.toBe(provB);
});

afterAll(() => db.close());

describe("a publication is tenant data", () => {
  it("each tenant sees only its own", async () => {
    await insertPublication(ctxA(), 1);
    await insertPublication(ctxB(), 1);

    expect(await countVisible(db.runtime, ctxA(), "portal.client_publication")).toBe(1);
    expect(await countVisible(db.runtime, ctxB(), "portal.client_publication")).toBe(1);
    expect(
      await countVisible(db.runtime, ctxA(), "portal.client_publication", {
        column: "tenant_id",
        value: w.tenantB.id,
      }),
    ).toBe(0);
  });

  it("a connection with no context sees nothing at all", async () => {
    const result = await db.runtime.execute(
      sql`select count(*)::int as n from portal.client_publication`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(0);
  });

  it("publishing into another tenant is refused by the write policy", async () => {
    const refused = await attempt(
      asContext(db.runtime, ctxA(), async (tx) => {
        await tx.execute(sql`
          insert into portal.client_publication
            (id, tenant_id, project_id, sequence, published_at, published_by, schema_version,
             content_hash, payload, source_provenance_ids)
          values (${randomUUID()}, ${w.tenantB.id}, ${w.projectZ.id}, 99, now(), ${w.memberA.id},
                  1, 'x', '{}'::jsonb, '[]'::jsonb)
        `);
      }),
    );
    expect(refused).toMatch(RLS_VIOLATION);
  });

  it("a member of the tenant with no access to the project sees none of its publications", async () => {
    // projectY belongs to tenant A and memberA has no membership on it.
    expect(await countVisible(db.runtime, ctxA(w.projectY.id), "portal.client_publication")).toBe(
      0,
    );
  });
});

describe("a publication is written once", () => {
  it("the runtime role has no UPDATE and no DELETE on it", async () => {
    const id = await insertPublication(ctxA(), 2);

    const updated = await attempt(
      asContext(db.runtime, ctxA(), async (tx) => {
        await tx.execute(
          sql`update portal.client_publication set content_hash = 'x' where id = ${id}`,
        );
      }),
    );
    expect(updated).toMatch(INSUFFICIENT_PRIVILEGE);

    const deleted = await attempt(
      asContext(db.runtime, ctxA(), async (tx) => {
        await tx.execute(sql`delete from portal.client_publication where id = ${id}`);
      }),
    );
    expect(deleted).toMatch(INSUFFICIENT_PRIVILEGE);
  });

  it("even the owning role cannot rewrite one: the trigger is the real rule", async () => {
    const rows = await db.migrator.execute(
      sql`select id from portal.client_publication order by sequence limit 1`,
    );
    const id = (rows.rows[0] as { id: string }).id;
    const refused = await attempt(
      db.migrator.execute(
        sql`update portal.client_publication set content_hash = 'rewritten' where id = ${id}`,
      ),
    );
    expect(refused).toMatch(/client_publication_immutable/);
  });

  it("a project's publications are removed with the project, and only that way", async () => {
    const before = await db.migrator.execute(
      sql`select count(*)::int as n from portal.client_publication where project_id = ${w.projectZ.id}`,
    );
    expect((before.rows[0] as { n: number }).n).toBeGreaterThan(0);
    await db.migrator.execute(sql`delete from app.project where id = ${w.projectZ.id}`);
    const after = await db.migrator.execute(
      sql`select count(*)::int as n from portal.client_publication where project_id = ${w.projectZ.id}`,
    );
    expect((after.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("the role that is deliberately not connected yet", () => {
  /**
   * `eia_portal` exists as a name in the architecture and has no grants here (TD-005). That is the
   * decision, not an omission: there is no external client session in this wave, so there is no
   * caller for the role, and granting it SELECT so it "looks implemented" would be surface with
   * nobody behind it. This test pins the decision so that widening it has to be deliberate.
   */
  it("has no privileges on the publication table", async () => {
    const result = await db.migrator.execute(sql`
      select count(*)::int as n
        from information_schema.role_table_grants
       where grantee = 'eia_portal' and table_schema = 'portal'
    `);
    expect((result.rows[0] as { n: number }).n).toBe(0);
  });

  it("the application role reads the projection through the ordinary predicate", async () => {
    const result = await db.migrator.execute(sql`
      select privilege_type
        from information_schema.role_table_grants
       where grantee = 'eia_app' and table_schema = 'portal' and table_name = 'client_publication'
       order by privilege_type
    `);
    expect(result.rows.map((row) => (row as { privilege_type: string }).privilege_type)).toEqual([
      "INSERT",
      "SELECT",
    ]);
  });
});
