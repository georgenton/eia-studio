import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asContext,
  attempt,
  countVisible,
  createProjectMembership,
  createTenantMembership,
  createUser,
  getTestDatabase,
  INSUFFICIENT_PRIVILEGE,
  resetDatabase,
  RLS_VIOLATION,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * The mobile sync receipt at the row level (Production V1, Wave 1).
 *
 * A receipt says *this named person's device did this thing*. It is therefore not project-wide
 * reference data: it takes the same door the field rows it describes take, plus one more
 * condition — it is the caller's own. A technician holds neither `field.read` nor
 * `field.responses.read`, and a receipt that could be read across technicians would hand one of
 * them a list of another's day.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let techA: { id: string };
let techB: { id: string };

const ctxFor = (userId: string, tenantId: string, projectId: string) => ({
  userId,
  tenantId,
  projectId,
});

async function insertReceipt(
  ctx: { userId: string; tenantId: string; projectId: string },
  commandId: string,
): Promise<string> {
  const id = randomUUID();
  await asContext(db.runtime, ctx, async (tx) => {
    await tx.execute(sql`
      insert into app.field_sync_receipt
        (id, tenant_id, project_id, user_id, command_id, command_type, outcome, entity_kind,
         entity_id, device_revision, result)
      values (${id}, ${ctx.tenantId}, ${ctx.projectId}, ${ctx.userId}, ${commandId},
              'visit.start', 'applied', 'visit', ${randomUUID()}, 1, ${"{}"}::jsonb)
    `);
  });
  return id;
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  const make = async (label: string, tenantId: string, projectId: string) => {
    const user = await createUser(db.migrator, label);
    const tenantMembership = await createTenantMembership(db.migrator, {
      tenantId,
      userId: user.id,
      role: "MEMBER",
    });
    await createProjectMembership(db.migrator, {
      tenantId,
      projectId,
      tenantMembershipId: tenantMembership.id,
      role: "FIELD_TECHNICIAN",
    });
    return user;
  };
  techA = await make("rls-tech-a", w.tenantA.id, w.projectX.id);
  techB = await make("rls-tech-b", w.tenantA.id, w.projectX.id);
});

afterAll(() => db.close());

describe("a receipt belongs to one technician", () => {
  it("each sees only their own, inside the same project", async () => {
    await insertReceipt(ctxFor(techA.id, w.tenantA.id, w.projectX.id), randomUUID());
    await insertReceipt(ctxFor(techB.id, w.tenantA.id, w.projectX.id), randomUUID());

    expect(
      await countVisible(
        db.runtime,
        ctxFor(techA.id, w.tenantA.id, w.projectX.id),
        "app.field_sync_receipt",
      ),
    ).toBe(1);
    expect(
      await countVisible(
        db.runtime,
        ctxFor(techB.id, w.tenantA.id, w.projectX.id),
        "app.field_sync_receipt",
      ),
    ).toBe(1);
  });

  it("a connection with no context sees nothing at all", async () => {
    const result = await db.runtime.execute(
      sql`select count(*)::int as n from app.field_sync_receipt`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(0);
  });

  it("writing a receipt as somebody else is refused by the policy", async () => {
    const refused = await attempt(
      asContext(db.runtime, ctxFor(techA.id, w.tenantA.id, w.projectX.id), async (tx) => {
        await tx.execute(sql`
          insert into app.field_sync_receipt
            (id, tenant_id, project_id, user_id, command_id, command_type, outcome, entity_kind,
             entity_id, device_revision, result)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${techB.id},
                  ${randomUUID()}, 'visit.start', 'applied', 'visit', ${randomUUID()}, 1,
                  ${"{}"}::jsonb)
        `);
      }),
    );
    expect(refused).toMatch(RLS_VIOLATION);
  });

  it("writing into another tenant is refused by the policy", async () => {
    const refused = await attempt(
      asContext(db.runtime, ctxFor(techA.id, w.tenantA.id, w.projectX.id), async (tx) => {
        await tx.execute(sql`
          insert into app.field_sync_receipt
            (id, tenant_id, project_id, user_id, command_id, command_type, outcome, entity_kind,
             entity_id, device_revision, result)
          values (${randomUUID()}, ${w.tenantB.id}, ${w.projectZ.id}, ${techA.id},
                  ${randomUUID()}, 'visit.start', 'applied', 'visit', ${randomUUID()}, 1,
                  ${"{}"}::jsonb)
        `);
      }),
    );
    expect(refused).toMatch(RLS_VIOLATION);
  });
});

describe("a receipt is written once", () => {
  it("the runtime role has no UPDATE and no DELETE on it", async () => {
    const ctx = ctxFor(techA.id, w.tenantA.id, w.projectX.id);
    const id = await insertReceipt(ctx, randomUUID());

    const updated = await attempt(
      asContext(db.runtime, ctx, async (tx) => {
        await tx.execute(
          sql`update app.field_sync_receipt set outcome = 'rejected' where id = ${id}`,
        );
      }),
    );
    expect(updated).toMatch(INSUFFICIENT_PRIVILEGE);

    const deleted = await attempt(
      asContext(db.runtime, ctx, async (tx) => {
        await tx.execute(sql`delete from app.field_sync_receipt where id = ${id}`);
      }),
    );
    expect(deleted).toMatch(INSUFFICIENT_PRIVILEGE);
  });

  it("the same command id cannot be recorded twice, which is the whole guarantee", async () => {
    const ctx = ctxFor(techA.id, w.tenantA.id, w.projectX.id);
    const commandId = randomUUID();
    await insertReceipt(ctx, commandId);
    const refused = await attempt(insertReceipt(ctx, commandId));
    expect(refused).toMatch(/duplicate key|unique/i);
  });

  it("even the owning role cannot rewrite one", async () => {
    const rows = await db.migrator.execute(sql`select id from app.field_sync_receipt limit 1`);
    const id = (rows.rows[0] as { id: string }).id;
    const refused = await attempt(
      db.migrator.execute(
        sql`update app.field_sync_receipt set outcome = 'rejected' where id = ${id}`,
      ),
    );
    expect(refused).toMatch(/field_sync_receipt_immutable/);
  });
});
