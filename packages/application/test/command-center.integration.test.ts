import { randomUUID } from "node:crypto";

import { appSchema } from "@eia/db";
import {
  FeatureDisabled,
  FORECAST_ALGORITHM_VERSION,
  NotFound,
  PermissionDenied,
  requireCapability,
  type SessionUser,
} from "@eia/domain";
import {
  createProvenanceRecord,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "@eia/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildRequestContext,
  loadCommandCenter,
  loadPortfolio,
  loadProvenanceView,
} from "../src/index";

/**
 * Server-side authorization of the Slice 1 read models. These assertions are the ones a reviewer
 * repeats by hand in the browser: a tenant ADMIN with no project assignment is denied, a member
 * cannot reach another project of the same tenant, and a provenance id from another project
 * cannot be opened by editing the URL.
 */
const session = (user: { id: string; email: string }): SessionUser => ({
  subject: user.id,
  email: user.email,
  name: null,
  emailVerified: true,
});

const db = getTestDatabase();
let w: TwoTenantWorld;
let provenanceX: string;
let provenanceZ: string;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);

  for (const key of ["core.projects", "gis.maps", "gis.parcels"] as const) {
    await db.migrator
      .insert(appSchema.tenantCapability)
      .values({ tenantId: w.tenantA.id, capabilityKey: key, entitled: true, enabled: true })
      .onConflictDoNothing();
  }

  provenanceX = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "HISTORICAL_OBSERVED",
      title: "Cifra histórica del proyecto X",
      // A concluded study's own capture date, deliberately far from any demo scenario clock.
      capturedAt: new Date("2024-03-05T00:00:00.000Z"),
    })
  ).id;
  provenanceZ = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantB.id,
      projectId: w.projectZ.id,
      title: "Cifra del proyecto Z",
    })
  ).id;

  await db.migrator.insert(appSchema.metricSnapshot).values({
    id: randomUUID(),
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    key: "universe_estimated",
    numericValue: "141",
    note: "dato real del estudio",
    displayOrder: 1,
    provenanceId: provenanceX,
  });
  await db.migrator.insert(appSchema.forecastSnapshot).values({
    id: randomUUID(),
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    algorithmVersion: FORECAST_ALGORITHM_VERSION,
    asOfDate: "2026-09-17",
    pending: 22,
    dailyCompletions: [5, 6, 4, 6, 5],
    windowDays: 5,
    movingAveragePerDay: "5.20",
    requiredRatePerDay: "7.30",
    activeTechnicians: 3,
    assignedTechnicians: 4,
    targetDate: "2026-09-20",
    projectedCloseDate: "2026-09-22",
    delayDays: 2,
    assumptions: ["sin días perdidos por lluvia"],
    provenanceId: provenanceX,
  });
});
afterAll(() => db.close());

const contextFor = (user: { id: string; email: string }, projectSlug?: string) =>
  buildRequestContext(db.runtime, {
    sessionUser: session(user),
    tenantSlug: w.tenantA.slug,
    ...(projectSlug === undefined ? {} : { projectSlug }),
  });

describe("loadCommandCenter", () => {
  it("returns the project's metrics and forecast to an assigned member", async () => {
    const ctx = await contextFor(w.memberA, w.projectX.slug);
    const view = await loadCommandCenter(db.runtime, ctx);
    expect(view.project.id).toBe(w.projectX.id);
    expect(view.metrics).toHaveLength(1);
    expect(view.metrics[0]?.numericValue).toBe(141);
    expect(view.metrics[0]?.provenance.regime).toBe("HISTORICAL_OBSERVED");
    expect(view.forecast?.delayDays).toBe(2);
    expect(view.forecast?.movingAveragePerDay).toBe(5.2);
  });

  it("every returned value carries the provenance it came from", async () => {
    const ctx = await contextFor(w.memberA, w.projectX.slug);
    const view = await loadCommandCenter(db.runtime, ctx);
    for (const metric of view.metrics) {
      expect(metric.provenanceId).toBeTruthy();
      expect(metric.provenance.transformations.length).toBeGreaterThan(0);
    }
  });

  it("D-015: a tenant ADMIN without a project membership is denied", async () => {
    const ctx = await contextFor(w.adminA, w.projectX.slug);
    expect(ctx.projectRole).toBeNull();
    expect(ctx.implicitOwnerProjectAccess).toBe(false);
    await expect(loadCommandCenter(db.runtime, ctx)).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("a tenant OWNER reaches it through implicit, audited access", async () => {
    const ctx = await contextFor(w.ownerA, w.projectX.slug);
    expect(ctx.implicitOwnerProjectAccess).toBe(true);
    const view = await loadCommandCenter(db.runtime, ctx);
    expect(view.metrics.length).toBeGreaterThan(0);
  });

  it("a member cannot build a context for a project they are not assigned to", async () => {
    await expect(contextFor(w.memberA, w.projectY.slug)).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("a member cannot build a context for another tenant's project", async () => {
    await expect(
      buildRequestContext(db.runtime, {
        sessionUser: session(w.memberA),
        tenantSlug: w.tenantB.slug,
        projectSlug: w.projectZ.slug,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});

/**
 * IG1-009. The scenario clock is a property of the simulated calculation; the project entity has
 * no demo state at all. These assertions are what stop it drifting back.
 */
describe("the demo scenario clock lives with the forecast", () => {
  it("the forecast carries its own anchor and its provenance regime", async () => {
    const ctx = await contextFor(w.memberA, w.projectX.slug);
    const view = await loadCommandCenter(db.runtime, ctx);
    expect(view.forecast?.asOfDate).toBe("2026-09-17");
    expect(view.forecast?.provenance.regime).toBeDefined();
  });

  it("the project header exposes no demo field", async () => {
    const ctx = await contextFor(w.memberA, w.projectX.slug);
    const view = await loadCommandCenter(db.runtime, ctx);
    for (const key of Object.keys(view.project)) {
      expect(key, `project.${key}`).not.toMatch(/demo|scenario|simulation/i);
    }
  });

  it("historical metrics keep their own capture time and do not inherit the scenario", async () => {
    const ctx = await contextFor(w.memberA, w.projectX.slug);
    const historical = await loadProvenanceView(db.runtime, ctx, provenanceX);
    expect(historical.facets.regime).toBe("HISTORICAL_OBSERVED");
    // The historical record was captured long before the simulation's as-of date, and nothing in
    // the read path rewrites it to the scenario.
    expect(historical.capturedAt?.toISOString().slice(0, 10)).toBe("2024-03-05");
    const view = await loadCommandCenter(db.runtime, ctx);
    const metric = view.metrics.find((m) => m.provenanceId === provenanceX);
    expect(metric?.provenance.regime).toBe("HISTORICAL_OBSERVED");
  });

  it("a project with no simulation needs no demo metadata anywhere", async () => {
    // Project Y has no forecast and no metrics; the read model returns a coherent view anyway.
    const ownerCtx = await contextFor(w.ownerA, w.projectY.slug);
    const view = await loadCommandCenter(db.runtime, ownerCtx);
    expect(view.forecast).toBeNull();
    expect(view.metrics).toEqual([]);
  });
});

describe("loadProvenanceView", () => {
  it("opens a record of the project in context", async () => {
    const ctx = await contextFor(w.memberA, w.projectX.slug);
    const view = await loadProvenanceView(db.runtime, ctx, provenanceX);
    expect(view.title).toBe("Cifra histórica del proyecto X");
    expect(view.facets.regime).toBe("HISTORICAL_OBSERVED");
  });

  it("refuses a provenance id belonging to another tenant's project", async () => {
    const ctx = await contextFor(w.memberA, w.projectX.slug);
    await expect(loadProvenanceView(db.runtime, ctx, provenanceZ)).rejects.toBeInstanceOf(NotFound);
  });

  it("refuses a random identifier without leaking whether it exists", async () => {
    const ctx = await contextFor(w.memberA, w.projectX.slug);
    await expect(loadProvenanceView(db.runtime, ctx, randomUUID())).rejects.toBeInstanceOf(
      NotFound,
    );
  });
});

/**
 * The server side of the capability route policy (ADR-016). The read model must refuse before it
 * reads, and it must refuse for a capability the project is not entitled to even when the caller
 * is a full member — which is what makes the 404 at the route honest rather than cosmetic.
 */
describe("capability enforcement in the read models", () => {
  it("a member of an entitled project reaches the Command Center", async () => {
    const ctx = await contextFor(w.memberA, w.projectX.slug);
    expect(ctx.capabilities["core.projects"]).toBe(true);
    await expect(loadCommandCenter(db.runtime, ctx)).resolves.toBeDefined();
  });

  it("an ANNOUNCED capability is never effective, so its route can only be a 404", async () => {
    const ctx = await contextFor(w.memberA, w.projectX.slug);
    // reports.social_generator is ANNOUNCED in the catalogue: presentation may show it, the
    // resolver never enables it, and requireCapability throws for it exactly as for a hidden one.
    expect(ctx.capabilities["reports.social_generator"]).toBe(false);
    expect(() => requireCapability(ctx, "reports.social_generator")).toThrow(FeatureDisabled);
  });

  it("a capability the tenant switched off stops being effective for its surface", async () => {
    await db.migrator
      .insert(appSchema.tenantCapability)
      .values({
        tenantId: w.tenantA.id,
        capabilityKey: "gis.parcels",
        entitled: true,
        enabled: false,
      })
      .onConflictDoUpdate({
        target: [appSchema.tenantCapability.tenantId, appSchema.tenantCapability.capabilityKey],
        set: { enabled: false },
      });
    const ctx = await contextFor(w.memberA, w.projectX.slug);
    expect(ctx.capabilities["gis.parcels"]).toBe(false);
    expect(() => requireCapability(ctx, "gis.parcels")).toThrow(FeatureDisabled);
    // …and core.projects is untouched, so the Command Center still resolves.
    expect(ctx.capabilities["core.projects"]).toBe(true);
    await db.migrator
      .insert(appSchema.tenantCapability)
      .values({
        tenantId: w.tenantA.id,
        capabilityKey: "gis.parcels",
        entitled: true,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: [appSchema.tenantCapability.tenantId, appSchema.tenantCapability.capabilityKey],
        set: { enabled: true },
      });
  });
});

describe("loadPortfolio", () => {
  it("shows only the projects the caller may see, with their figures", async () => {
    const ctx = await contextFor(w.memberA);
    const view = await loadPortfolio(db.runtime, ctx);
    const slugs = view.projects.map((p) => p.slug);
    expect(slugs).toContain(w.projectX.slug);
    expect(slugs).not.toContain(w.projectZ.slug);
    const projectX = view.projects.find((p) => p.slug === w.projectX.slug);
    expect(projectX?.metrics.some((m) => m.key === "universe_estimated")).toBe(true);
  });

  it("D-015: a tenant ADMIN sees project rows but none of their figures", async () => {
    const ctx = await contextFor(w.adminA);
    const view = await loadPortfolio(db.runtime, ctx);
    expect(view.projects.length).toBeGreaterThan(0);
    for (const project of view.projects) expect(project.metrics).toHaveLength(0);
    expect(view.metricsRestricted).toBe(true);
  });
});
