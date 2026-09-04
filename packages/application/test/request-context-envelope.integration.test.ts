import { withDbContext } from "@eia/db";
import { PermissionDenied, type SessionUser } from "@eia/domain";
import {
  createTenant,
  createTenantMembership,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type TwoTenantWorld,
} from "@eia/testing";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveAccessContext } from "../src/index";

/**
 * The authorization path now resolves the caller in **one** transaction instead of four (TD-064).
 * This file is the reason that was allowed to happen: merging transactions changes the row-level
 * envelope of the code that decides who may read what, and a performance argument is not a licence
 * to weaken it.
 *
 * The properties asserted are the ones the split used to guarantee structurally:
 *
 * 1. the tenant is proved by a membership join with `app.tenant_id` **unset**, so a slug the caller
 *    supplied never becomes the tenant they are read as;
 * 2. the adopted tenant is the one that was proved, so a user who belongs to two tenants sees the
 *    one in the URL and its settings, never the other's;
 * 3. `app.project_id` stays unset, so project access still comes from membership;
 * 4. the settings are transaction-local and nothing survives onto the pooled connection;
 * 5. a denial writes nothing.
 */
const session = (user: { id: string; email: string }): SessionUser => ({
  subject: user.id,
  email: user.email,
  name: null,
  emailVerified: true,
});

const db = getTestDatabase();
let w: TwoTenantWorld;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
});
afterAll(() => db.close());

describe("the merged transaction resolves the same caller as the four it replaced", () => {
  it("gives a member their project, their role and their tenant's settings", async () => {
    const { ctx, tenantSettings } = await resolveAccessContext(db.runtime, {
      sessionUser: session(w.memberA),
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    expect(ctx.tenantId).toBe(w.tenantA.id);
    expect(ctx.projectId).toBe(w.projectX.id);
    expect(ctx.projectRole).toBe("VIEWER");
    expect(ctx.capabilities["gis.parcels"]).toBe(true);
    // The settings the shell needs come back with the context rather than from a second read.
    expect(tenantSettings.get("core.projects")).toEqual({ entitled: true, enabled: true });
  });

  it("refuses a tenant the caller has no membership in, however the slug was obtained", async () => {
    await expect(
      resolveAccessContext(db.runtime, {
        sessionUser: session(w.memberA),
        tenantSlug: w.tenantB.slug,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("refuses a project of another tenant even though a tenant has been adopted", async () => {
    // The adopted tenant is A; `project-z` exists, in B. Under RLS it is not there to be found.
    await expect(
      resolveAccessContext(db.runtime, {
        sessionUser: session(w.memberA),
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectZ.slug,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("refuses a project of the right tenant the caller is not assigned to", async () => {
    await expect(
      resolveAccessContext(db.runtime, {
        sessionUser: session(w.memberA),
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectY.slug,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});

describe("the tenant that is adopted is the tenant that was proved", () => {
  it("keeps two memberships of one person apart, settings included", async () => {
    // The same person, in both tenants. If the adopted tenant were anything other than the one the
    // membership join proved, this is where it would show: the capabilities would be the other's.
    const tenantC = await createTenant(db.migrator, "tenant-c");
    await createTenantMembership(db.migrator, {
      tenantId: tenantC.id,
      userId: w.memberA.id,
      role: "ADMIN",
    });
    await setTenantCapability(db.migrator, {
      tenantId: tenantC.id,
      key: "core.projects",
      entitled: true,
      enabled: false,
    });

    const a = await resolveAccessContext(db.runtime, {
      sessionUser: session(w.memberA),
      tenantSlug: w.tenantA.slug,
    });
    const c = await resolveAccessContext(db.runtime, {
      sessionUser: session(w.memberA),
      tenantSlug: tenantC.slug,
    });

    expect(a.ctx.tenantId).toBe(w.tenantA.id);
    expect(a.ctx.tenantRole).toBe("MEMBER");
    expect(a.ctx.capabilities["core.projects"]).toBe(true);

    expect(c.ctx.tenantId).toBe(tenantC.id);
    expect(c.ctx.tenantRole).toBe("ADMIN");
    // Entitled but switched off for this tenant: the settings that decided it are tenant C's.
    expect(c.ctx.capabilities["core.projects"]).toBe(false);
    expect(c.tenantSettings.get("core.projects")).toEqual({ entitled: true, enabled: false });
  });
});

describe("nothing outlives the transaction", () => {
  it("leaves no tenant on the pooled connection", async () => {
    await resolveAccessContext(db.runtime, {
      sessionUser: session(w.memberA),
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    // A later unit of work with no context must see none: `set_config(..., true)` is per
    // transaction, and adopting a tenant mid-transaction must not change that.
    const settings = await db.runtime.execute(sql`
      select coalesce(current_setting('app.tenant_id', true), '') as tenant,
             coalesce(current_setting('app.project_id', true), '') as project
    `);
    expect(settings.rows[0]).toEqual({ tenant: "", project: "" });
  });

  it("writes no user row when access is denied, because the whole resolution rolls back", async () => {
    // The reconciliation of the application user row is the first statement of the same
    // transaction. A caller who is refused therefore leaves nothing behind — which is the change
    // this merge makes to observable behaviour, and it is the direction worth having: a row for
    // somebody with access to nothing is a row nobody asked for.
    const stranger: SessionUser = {
      subject: randomUUID(),
      email: `stranger-${randomUUID()}@demo.invalid`,
      name: null,
      emailVerified: true,
    };
    await expect(
      resolveAccessContext(db.runtime, { sessionUser: stranger, tenantSlug: w.tenantA.slug }),
    ).rejects.toBeInstanceOf(PermissionDenied);

    const rows = await db.migrator.execute(sql`
      select count(*)::int as n from app."user" where id = ${stranger.subject}
    `);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("creates the user row exactly once when access is granted", async () => {
    await withDbContext(
      db.migrator,
      { userId: null, tenantId: null, projectId: null },
      async () => undefined,
    );
    await resolveAccessContext(db.runtime, {
      sessionUser: session(w.memberA),
      tenantSlug: w.tenantA.slug,
    });
    const rows = await db.migrator.execute(sql`
      select count(*)::int as n from app."user" where id = ${w.memberA.id}
    `);
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });
});
