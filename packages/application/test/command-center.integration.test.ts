import { randomUUID } from "node:crypto";

import { appSchema } from "@eia/db";
import {
  FORECAST_ALGORITHM_VERSION,
  NotFound,
  PermissionDenied,
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
