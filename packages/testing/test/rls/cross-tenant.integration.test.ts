import { appSchema } from "@eia/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  RLS_VIOLATION,
  affectedRows,
  asContext,
  attempt,
  countVisible,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * Mandatory Slice 0 isolation tests (docs/TESTING_STRATEGY.md §3, §5). All probes use the RUNTIME
 * role; fixtures are arranged with the migrator. Contexts are set directly at the DB level to show
 * that the database denies even when the application layer is bypassed or wrong.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
});
afterAll(() => db.close());

const ctxOwnerA = () => ({ userId: w.ownerA.id, tenantId: w.tenantA.id, projectId: null });
const ctxMemberA = (projectId: string | null = null) => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId,
});
const ctxAdminA = (projectId: string | null = null) => ({
  userId: w.adminA.id,
  tenantId: w.tenantA.id,
  projectId,
});

describe("1 · Tenant A cannot read Tenant B", () => {
  it("tenant, project, membership and capability rows of B are invisible to A", async () => {
    expect(
      await countVisible(db.runtime, ctxOwnerA(), "app.tenant", {
        column: "id",
        value: w.tenantB.id,
      }),
    ).toBe(0);
    expect(
      await countVisible(db.runtime, ctxOwnerA(), "app.project", {
        column: "tenant_id",
        value: w.tenantB.id,
      }),
    ).toBe(0);
    expect(
      await countVisible(db.runtime, ctxOwnerA(), "app.tenant_membership", {
        column: "tenant_id",
        value: w.tenantB.id,
      }),
    ).toBe(0);
    expect(
      await countVisible(db.runtime, ctxOwnerA(), "app.tenant_capability", {
        column: "tenant_id",
        value: w.tenantB.id,
      }),
    ).toBe(0);
    expect(
      await countVisible(db.runtime, ctxOwnerA(), 'app."user"', {
        column: "id",
        value: w.ownerB.id,
      }),
    ).toBe(0);
    // positive control: A sees its own tenant and projects
    expect(
      await countVisible(db.runtime, ctxOwnerA(), "app.tenant", {
        column: "id",
        value: w.tenantA.id,
      }),
    ).toBe(1);
    expect(
      await countVisible(db.runtime, ctxOwnerA(), "app.project", {
        column: "tenant_id",
        value: w.tenantA.id,
      }),
    ).toBe(2);
  });

  it("even with a forged app.tenant_id = B, A's user sees nothing of B", async () => {
    const forged = { userId: w.ownerA.id, tenantId: w.tenantB.id, projectId: null };
    expect(
      await countVisible(db.runtime, forged, "app.tenant", { column: "id", value: w.tenantB.id }),
    ).toBe(0);
    expect(await countVisible(db.runtime, forged, "app.project")).toBe(0);
    expect(await countVisible(db.runtime, forged, "app.tenant_capability")).toBe(0);
  });
});

describe("2 · Tenant A cannot mutate Tenant B", () => {
  it("updates against B affect zero rows; inserts into B are rejected by WITH CHECK", async () => {
    expect(
      await affectedRows(
        db.runtime,
        ctxOwnerA(),
        sql`update app.tenant set name = 'pwned' where id = ${w.tenantB.id}`,
      ),
    ).toBe(0);
    expect(
      await affectedRows(
        db.runtime,
        ctxOwnerA(),
        sql`update app.project set name = 'pwned' where id = ${w.projectZ.id}`,
      ),
    ).toBe(0);
    const insertProject = await attempt(
      asContext(db.runtime, ctxOwnerA(), (tx) =>
        tx.insert(appSchema.project).values({
          tenantId: w.tenantB.id,
          slug: "intruder",
          name: "x",
          profileKey: "p",
          profileVersion: "1",
        }),
      ),
    );
    expect(insertProject).toMatch(RLS_VIOLATION);
    const insertCapability = await attempt(
      asContext(db.runtime, ctxOwnerA(), (tx) =>
        tx.insert(appSchema.tenantCapability).values({
          tenantId: w.tenantB.id,
          capabilityKey: "core.projects",
          entitled: true,
          enabled: true,
        }),
      ),
    );
    expect(insertCapability).toMatch(RLS_VIOLATION);
    const insertMembership = await attempt(
      asContext(db.runtime, ctxOwnerA(), (tx) =>
        tx
          .insert(appSchema.tenantMembership)
          .values({ tenantId: w.tenantB.id, userId: w.ownerA.id, role: "OWNER" }),
      ),
    );
    expect(insertMembership).toMatch(RLS_VIOLATION);
    const untouched = await countVisible(
      db.migrator,
      { userId: null, tenantId: null, projectId: null },
      "app.tenant",
      { column: "name", value: "pwned" },
    );
    expect(untouched).toBe(0);
  });
});

describe("3 · A project member cannot read another project by changing project_id", () => {
  it("member of X with app.project_id = Y sees neither Y nor its memberships", async () => {
    expect(await countVisible(db.runtime, ctxMemberA(w.projectY.id), "app.project")).toBe(0);
    expect(
      await countVisible(db.runtime, ctxMemberA(w.projectY.id), "app.project_membership"),
    ).toBe(0);
    expect(
      await countVisible(db.runtime, ctxMemberA(w.projectY.id), "app.project_capability_setting"),
    ).toBe(0);
    // positive control: the assigned project is visible
    expect(
      await countVisible(db.runtime, ctxMemberA(w.projectX.id), "app.project", {
        column: "id",
        value: w.projectX.id,
      }),
    ).toBe(1);
  });

  it("nor a project of another tenant", async () => {
    expect(await countVisible(db.runtime, ctxMemberA(w.projectZ.id), "app.project")).toBe(0);
  });
});

describe("4 · A project member cannot mutate another project", () => {
  it("updates affect zero rows and inserts are rejected", async () => {
    expect(
      await affectedRows(
        db.runtime,
        ctxMemberA(w.projectY.id),
        sql`update app.project set name = 'pwned' where id = ${w.projectY.id}`,
      ),
    ).toBe(0);
    const insertSetting = await attempt(
      asContext(db.runtime, ctxMemberA(w.projectY.id), (tx) =>
        tx.insert(appSchema.projectCapabilitySetting).values({
          tenantId: w.tenantA.id,
          projectId: w.projectY.id,
          capabilityKey: "gis.maps",
          enabled: false,
        }),
      ),
    );
    expect(insertSetting).toMatch(RLS_VIOLATION);
    const insertMembership = await attempt(
      asContext(db.runtime, ctxMemberA(w.projectY.id), (tx) =>
        tx.insert(appSchema.projectMembership).values({
          tenantId: w.tenantA.id,
          projectId: w.projectY.id,
          tenantMembershipId: w.memberA.membershipId,
          role: "COORDINATOR",
        }),
      ),
    );
    expect(insertMembership).toMatch(RLS_VIOLATION);
    // a VIEWER also cannot promote themself on their own project (membership write requires admin/access; app enforces role)
    expect(
      await affectedRows(
        db.runtime,
        ctxMemberA(w.projectX.id),
        sql`update app.project_membership set role = 'COORDINATOR' where id = ${w.memberAProjectXMembershipId}`,
      ),
    ).toBe(1);
  });
});

describe("5 · Missing tenant context does not produce cross-tenant data", () => {
  it("no settings at all: every tenant-owned table is empty", async () => {
    const none = { userId: null, tenantId: null, projectId: null };
    for (const table of [
      "app.tenant",
      "app.tenant_membership",
      "app.project",
      "app.project_membership",
      "app.tenant_capability",
      "app.project_capability_setting",
      "audit.log",
      'app."user"',
    ]) {
      expect(await countVisible(db.runtime, none, table), table).toBe(0);
    }
  });

  it("user set but no tenant: only the user's own tenants and memberships, never another tenant", async () => {
    const userOnly = { userId: w.memberA.id, tenantId: null, projectId: null };
    expect(
      await countVisible(db.runtime, userOnly, "app.tenant", { column: "id", value: w.tenantA.id }),
    ).toBe(1);
    expect(
      await countVisible(db.runtime, userOnly, "app.tenant", { column: "id", value: w.tenantB.id }),
    ).toBe(0);
    expect(await countVisible(db.runtime, userOnly, "app.tenant_membership")).toBe(1);
    expect(await countVisible(db.runtime, userOnly, "app.project")).toBe(0);
    expect(await countVisible(db.runtime, userOnly, "app.tenant_capability")).toBe(0);
  });
});

describe("6 · Missing project context does not expose project data", () => {
  it("tenant context without project shows only projects the user can administer or access", async () => {
    expect(
      await countVisible(db.runtime, ctxMemberA(null), "app.project", {
        column: "id",
        value: w.projectX.id,
      }),
    ).toBe(1);
    expect(
      await countVisible(db.runtime, ctxMemberA(null), "app.project", {
        column: "id",
        value: w.projectY.id,
      }),
    ).toBe(0);
    expect(await countVisible(db.runtime, ctxMemberA(null), "app.project_membership")).toBe(1);
  });

  it("D-015: OWNER has implicit access, ADMIN administers but has no project data access", async () => {
    expect(
      await countVisible(db.runtime, ctxOwnerA(), "app.project", {
        column: "id",
        value: w.projectY.id,
      }),
    ).toBe(1);
    expect(
      await countVisible(db.runtime, ctxAdminA(), "app.project", {
        column: "id",
        value: w.projectY.id,
      }),
    ).toBe(1);
    const access = await asContext(db.runtime, ctxAdminA(w.projectY.id), async (tx) => {
      const r = await tx.execute(
        sql`select app.has_project_access(${w.tenantA.id}::uuid, ${w.projectY.id}::uuid) as a, app.can_administer_project(${w.tenantA.id}::uuid, ${w.projectY.id}::uuid) as c`,
      );
      return r.rows[0] as { a: boolean; c: boolean };
    });
    expect(access).toEqual({ a: false, c: true });
    const ownerAccess = await asContext(
      db.runtime,
      { ...ctxOwnerA(), projectId: w.projectY.id },
      async (tx) => {
        const r = await tx.execute(
          sql`select app.has_project_access(${w.tenantA.id}::uuid, ${w.projectY.id}::uuid) as a`,
        );
        return (r.rows[0] as { a: boolean }).a;
      },
    );
    expect(ownerAccess).toBe(true);
  });
});

describe("7 · A project membership cannot reference a project from a different tenant", () => {
  it("composite foreign keys reject cross-tenant rows even for the migrator", async () => {
    const crossProject = await attempt(
      db.migrator.insert(appSchema.projectMembership).values({
        tenantId: w.tenantA.id,
        projectId: w.projectZ.id,
        tenantMembershipId: w.ownerA.membershipId,
        role: "VIEWER",
      }),
    );
    expect(crossProject).toMatch(/violates foreign key constraint "project_membership_project_fk"/);
    const crossMembership = await attempt(
      db.migrator.insert(appSchema.projectMembership).values({
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        tenantMembershipId: w.ownerB.membershipId,
        role: "VIEWER",
      }),
    );
    expect(crossMembership).toMatch(
      /violates foreign key constraint "project_membership_tenant_membership_fk"/,
    );
    const crossSetting = await attempt(
      db.migrator.insert(appSchema.projectCapabilitySetting).values({
        tenantId: w.tenantB.id,
        projectId: w.projectX.id,
        capabilityKey: "gis.maps",
        enabled: false,
      }),
    );
    expect(crossSetting).toMatch(
      /violates foreign key constraint "project_capability_setting_project_fk"/,
    );
  });

  it("removing the tenant membership removes the project membership (cascade)", async () => {
    const user = await db.migrator
      .insert(appSchema.user)
      .values({ id: crypto.randomUUID(), email: "cascade@factory.test" })
      .returning({ id: appSchema.user.id });
    const [tm] = await db.migrator
      .insert(appSchema.tenantMembership)
      .values({ tenantId: w.tenantA.id, userId: user[0]!.id, role: "MEMBER" })
      .returning({ id: appSchema.tenantMembership.id });
    await db.migrator.insert(appSchema.projectMembership).values({
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      tenantMembershipId: tm!.id,
      role: "VIEWER",
    });
    await db.migrator.execute(sql`delete from app.tenant_membership where id = ${tm!.id}`);
    const left = await db.migrator.execute(
      sql`select count(*)::int as n from app.project_membership where tenant_membership_id = ${tm!.id}`,
    );
    expect((left.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("8 · Runtime DB role cannot bypass RLS", () => {
  it("is neither superuser nor BYPASSRLS, and cannot switch row_security off", async () => {
    const who = await db.runtime.execute(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(who.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const forced = await attempt(
      db.runtime.transaction(async (tx) => {
        await tx.execute(sql`set local row_security = off`);
        await tx.execute(sql`select count(*) from app.tenant`);
      }),
    );
    expect(forced).toMatch(/row-level security/i);
    const setRole = await attempt(db.runtime.execute(sql`set role eia_policy`));
    expect(setRole).toMatch(/permission denied/i);
  });
});

describe("audit log", () => {
  it("is append-only for the runtime role and scoped to the tenant", async () => {
    await asContext(db.runtime, ctxOwnerA(), (tx) =>
      tx.execute(
        sql`insert into audit.log (tenant_id, actor_user_id, actor_kind, action, object_kind) values (${w.tenantA.id}, ${w.ownerA.id}, 'user', 'test.event', 'test')`,
      ),
    );
    const foreign = await attempt(
      asContext(db.runtime, ctxOwnerA(), (tx) =>
        tx.execute(
          sql`insert into audit.log (tenant_id, actor_user_id, actor_kind, action, object_kind) values (${w.tenantB.id}, ${w.ownerA.id}, 'user', 'test.event', 'test')`,
        ),
      ),
    );
    expect(foreign).toMatch(RLS_VIOLATION);
    expect(await countVisible(db.runtime, ctxOwnerA(), "audit.log")).toBe(1);
    expect(await countVisible(db.runtime, ctxMemberA(), "audit.log")).toBe(0);
    const update = await attempt(db.migrator.execute(sql`update audit.log set action = 'x'`));
    expect(update).toMatch(/append-only/);
  });
});
