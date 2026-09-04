import { appSchema } from "@eia/db";
import {
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "@eia/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FeatureDisabled,
  PermissionDenied,
  RoleEscalation,
  navigationPresentation,
  requireCapability,
  type SessionUser,
} from "@eia/domain";
import {
  addProjectMembership,
  addTenantMembership,
  buildRequestContext,
  createProject,
  createTenant,
  ensureUser,
  listPortfolio,
  setProjectCapability,
  loadTenantCapabilitySettings,
} from "../src/index";
import { withDbContext } from "@eia/db";

/** Session users as the identity port would return them (subject = app.user.id). */
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

describe("buildRequestContext", () => {
  it("resolves tenant role and tenant-scope permissions", async () => {
    const ctx = await buildRequestContext(db.runtime, {
      sessionUser: session(w.ownerA),
      tenantSlug: w.tenantA.slug,
    });
    expect(ctx.tenantRole).toBe("OWNER");
    expect(ctx.projectId).toBeNull();
    expect(ctx.permissions.has("members.manage")).toBe(true);
    expect(ctx.capabilities["core.projects"]).toBe(true);
    expect(ctx.capabilities["social.ai_coding"]).toBe(false);
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it("denies a tenant the user does not belong to, indistinguishably from a non-existent one", async () => {
    await expect(
      buildRequestContext(db.runtime, {
        sessionUser: session(w.ownerA),
        tenantSlug: w.tenantB.slug,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      buildRequestContext(db.runtime, {
        sessionUser: session(w.ownerA),
        tenantSlug: "does-not-exist",
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("explicit project membership yields the project role", async () => {
    const ctx = await buildRequestContext(db.runtime, {
      sessionUser: session(w.memberA),
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    expect(ctx.projectRole).toBe("VIEWER");
    expect(ctx.implicitOwnerProjectAccess).toBe(false);
    expect(ctx.permissions.has("parcels.read")).toBe(true);
    expect(ctx.permissions.has("pii.read")).toBe(false);
  });

  it("MEMBER without assignment is denied; a foreign project slug is denied", async () => {
    await expect(
      buildRequestContext(db.runtime, {
        sessionUser: session(w.memberA),
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectY.slug,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      buildRequestContext(db.runtime, {
        sessionUser: session(w.ownerA),
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectZ.slug,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("OWNER implicit project access is explicit in the context and audited (D-015)", async () => {
    const ctx = await buildRequestContext(db.runtime, {
      sessionUser: session(w.ownerA),
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectY.slug,
    });
    expect(ctx.projectRole).toBeNull();
    expect(ctx.implicitOwnerProjectAccess).toBe(true);
    expect(ctx.permissions.has("parcels.write")).toBe(true);
    const audit = await db.migrator
      .select({ action: appSchema.tenant.id })
      .from(appSchema.tenant)
      .where(eq(appSchema.tenant.id, w.tenantA.id));
    expect(audit).toHaveLength(1);
    const rows = await db.migrator.execute(
      sql`select action, object_id from audit.log where tenant_id = ${w.tenantA.id} and action = 'access.owner_implicit_project'`,
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(1);
    expect((rows.rows[0] as { object_id: string }).object_id).toBe(w.projectY.id);
  });

  it("ADMIN without assignment gets administration only, no project data permissions", async () => {
    const ctx = await buildRequestContext(db.runtime, {
      sessionUser: session(w.adminA),
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectY.slug,
    });
    expect(ctx.tenantRole).toBe("ADMIN");
    expect(ctx.projectRole).toBeNull();
    expect(ctx.implicitOwnerProjectAccess).toBe(false);
    expect(ctx.permissions.has("project.members.manage")).toBe(true);
    expect(ctx.permissions.has("parcels.read")).toBe(false);
    expect(ctx.permissions.has("pii.read")).toBe(false);
  });
});

describe("tenant and project use-cases through the runtime role", () => {
  it("creates a tenant, becomes OWNER, gets plan entitlements and a boolean capability set", async () => {
    const user = { id: crypto.randomUUID(), email: `founder-${Date.now()}@factory.test` };
    await ensureUser(db.runtime, session(user));
    const { tenantId } = await createTenant(
      db.runtime,
      { userId: user.id, requestId: "r1" },
      { slug: `founded-${Date.now()}`, name: "Founded Co" },
    );
    const slug = (
      await db.migrator
        .select({ slug: appSchema.tenant.slug })
        .from(appSchema.tenant)
        .where(eq(appSchema.tenant.id, tenantId))
    )[0]!.slug;
    const ctx = await buildRequestContext(db.runtime, {
      sessionUser: session(user),
      tenantSlug: slug,
    });
    expect(ctx.tenantRole).toBe("OWNER");
    expect(ctx.capabilities["core.projects"]).toBe(true);
    // Slice 7 shipped the generator, so a founded tenant has it: AVAILABLE, entitled by the
    // plan, no project layer yet. The nav placeholder it used to be is gone (TD-055).
    expect(ctx.capabilities["reports.social_generator"]).toBe(true);
    expect(ctx.capabilities["climate.analytics"]).toBe(false);
    const settings = await withDbContext(
      db.runtime,
      { userId: user.id, tenantId, projectId: null },
      (tx) => loadTenantCapabilitySettings(tx, tenantId),
    );
    expect(navigationPresentation("reports.social_generator", ctx.capabilities, settings)).toBe(
      "ACTIVE",
    );
    expect(navigationPresentation("climate.analytics", ctx.capabilities, settings)).toBe("HIDDEN");

    const { projectId } = await createProject(db.runtime, ctx, {
      slug: "first-project",
      name: "First",
      profileKey: "road_eia_social",
    });
    const projectCtx = await buildRequestContext(db.runtime, {
      sessionUser: session(user),
      tenantSlug: slug,
      projectSlug: "first-project",
    });
    expect(projectCtx.projectId).toBe(projectId);
    expect(projectCtx.capabilities["gis.parcels"]).toBe(true);
    expect(() => requireCapability(projectCtx, "climate.analytics")).toThrowError(FeatureDisabled);
    expect(() => requireCapability(projectCtx, "reports.social_generator")).not.toThrow();
    expect(() => requireCapability(projectCtx, "core.projects")).not.toThrow();
    const portfolio = await listPortfolio(db.runtime, ctx);
    expect(portfolio.map((p) => p.slug)).toEqual(["first-project"]);

    // project override cannot widen: the extension is not entitled to the tenant
    await expect(
      setProjectCapability(db.runtime, projectCtx, { key: "climate.analytics", enabled: true }),
    ).rejects.toBeInstanceOf(FeatureDisabled);
    await setProjectCapability(db.runtime, projectCtx, { key: "gis.parcels", enabled: false });
    const restricted = await buildRequestContext(db.runtime, {
      sessionUser: session(user),
      tenantSlug: slug,
      projectSlug: "first-project",
    });
    expect(restricted.capabilities["gis.parcels"]).toBe(false);
    expect(restricted.capabilities["field.surveys"]).toBe(false); // dependency
  });

  it("MEMBER cannot create projects or add members; ADMIN cannot grant OWNER", async () => {
    const memberCtx = await buildRequestContext(db.runtime, {
      sessionUser: session(w.memberA),
      tenantSlug: w.tenantA.slug,
    });
    await expect(
      createProject(db.runtime, memberCtx, {
        slug: "nope",
        name: "Nope",
        profileKey: "road_eia_social",
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      addTenantMembership(db.runtime, memberCtx, { userId: w.ownerB.id, role: "MEMBER" }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    const adminCtx = await buildRequestContext(db.runtime, {
      sessionUser: session(w.adminA),
      tenantSlug: w.tenantA.slug,
    });
    await expect(
      addTenantMembership(db.runtime, adminCtx, { userId: w.ownerB.id, role: "OWNER" }),
    ).rejects.toBeInstanceOf(RoleEscalation);
    const viewerCtx = await buildRequestContext(db.runtime, {
      sessionUser: session(w.memberA),
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    await expect(
      addProjectMembership(db.runtime, viewerCtx, {
        tenantMembershipId: w.adminA.membershipId,
        role: "VIEWER",
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("payload identifiers are validated against the context: strict schemas reject extra fields", async () => {
    const ownerCtx = await buildRequestContext(db.runtime, {
      sessionUser: session(w.ownerA),
      tenantSlug: w.tenantA.slug,
    });
    await expect(
      createProject(db.runtime, ownerCtx, {
        slug: "smuggle",
        name: "S",
        profileKey: "road_eia_social",
        tenantId: w.tenantB.id,
      }),
    ).rejects.toThrow(/Unrecognized key|unrecognized/i);
  });
});
