import { appSchema } from "@eia/db";
import { NotFound, PermissionDenied, type SessionUser } from "@eia/domain";
import {
  createParcelWithGeometry,
  createProvenanceRecord,
  createSpatialDatasetVersion,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildRequestContext, loadParcelExplorer, loadParcelWorkspace } from "../src/index";

/**
 * Server-side authorization and scoping of the Slice 2 read models. The map is fed by these two
 * functions and nothing else, so an omission here would be a geometry leak that RLS then has to
 * catch on its own; both layers are asserted, here and in the RLS suite.
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

  for (const tenantId of [w.tenantA.id, w.tenantB.id]) {
    for (const key of ["core.projects", "gis.maps", "gis.parcels"] as const) {
      await db.migrator
        .insert(appSchema.tenantCapability)
        .values({ tenantId, capabilityKey: key, entitled: true, enabled: true })
        .onConflictDoNothing();
    }
  }

  for (const [tenant, project, code] of [
    [w.tenantA, w.projectX, "PRED-XXX-001"],
    [w.tenantA, w.projectY, "PRED-YYY-001"],
    [w.tenantB, w.projectZ, "PRED-XXX-001"],
  ] as const) {
    const provenanceId = (
      await createProvenanceRecord(db.migrator, {
        tenantId: tenant.id,
        projectId: project.id,
        regime: "DEMO_SIMULATION",
      })
    ).id;
    const version = await createSpatialDatasetVersion(db.migrator, {
      tenantId: tenant.id,
      projectId: project.id,
      provenanceId,
    });
    await createParcelWithGeometry(db.migrator, {
      tenantId: tenant.id,
      projectId: project.id,
      provenanceId,
      datasetVersionId: version.id,
      parcelCode: code,
    });
  }
});
afterAll(() => db.close());

const contextFor = (
  user: { id: string; email: string },
  tenantSlug: string,
  projectSlug?: string,
) =>
  buildRequestContext(db.runtime, {
    sessionUser: session(user),
    tenantSlug,
    ...(projectSlug === undefined ? {} : { projectSlug }),
  });

describe("loadParcelExplorer", () => {
  it("returns only the parcels of the context's project", async () => {
    const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
    const view = await loadParcelExplorer(db.runtime, ctx);
    expect(view.parcels).toHaveLength(1);
    expect(view.parcels[0]?.parcelCode).toBe("PRED-XXX-001");
    expect(view.features).toHaveLength(1);
  });

  it("returns every parcel as a feature, so the map and the table cannot disagree", async () => {
    const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
    const view = await loadParcelExplorer(db.runtime, ctx);
    const rowIds = new Set(view.parcels.map((p) => p.id));
    for (const feature of view.features) expect(rowIds.has(feature.id)).toBe(true);
  });

  it("labels each layer from its provenance facets rather than a stored source type", async () => {
    const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
    const view = await loadParcelExplorer(db.runtime, ctx);
    expect(view.layers.length).toBeGreaterThan(0);
    for (const layer of view.layers) {
      expect(layer.legend).toBe("SYNTHETIC_PARCELS");
      expect(layer.provenance.regime).toBe("DEMO_SIMULATION");
      expect(layer.provenanceId).toBeTruthy();
    }
  });

  it("gives every parcel a provenance record, never an unattributed figure", async () => {
    const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
    for (const parcel of (await loadParcelExplorer(db.runtime, ctx)).parcels) {
      expect(parcel.provenanceId).toBeTruthy();
      expect(parcel.provenance.transformations.length).toBeGreaterThan(0);
    }
  });

  it("D-015: a tenant ADMIN without a project membership is denied", async () => {
    const ctx = await contextFor(w.adminA, w.tenantA.slug, w.projectX.slug);
    await expect(loadParcelExplorer(db.runtime, ctx)).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("a member cannot read another project of the same tenant", async () => {
    // Building the context is itself the denial: the project membership does not exist.
    await expect(contextFor(w.memberA, w.tenantA.slug, w.projectY.slug)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it("a member cannot read a project of another tenant", async () => {
    await expect(contextFor(w.memberA, w.tenantB.slug, w.projectZ.slug)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it("bounds the payload so one project cannot ask the server for an unbounded map", async () => {
    const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
    const view = await loadParcelExplorer(db.runtime, ctx);
    expect(view.parcels.length).toBeLessThanOrEqual(2000);
    expect(view.truncated).toBe(false);
  });
});

describe("loadParcelWorkspace", () => {
  it("returns the parcel of the context's project", async () => {
    const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
    const view = await loadParcelWorkspace(db.runtime, ctx, "PRED-XXX-001");
    expect(view.parcel.parcelCode).toBe("PRED-XXX-001");
    expect(view.geometry).not.toBeNull();
  });

  it("a code that exists only in another tenant is not found, not someone else's parcel", async () => {
    const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
    // The same code exists in tenant B. Resolution is by (tenant, project, code), never by code.
    const view = await loadParcelWorkspace(db.runtime, ctx, "PRED-XXX-001");
    const owner = await db.migrator.execute(sql`
      select project_id from app.parcel where id = ${view.parcel.id}
    `);
    expect((owner.rows[0] as { project_id: string }).project_id).toBe(w.projectX.id);
  });

  it("a code from another project of the same tenant is not found", async () => {
    const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
    await expect(loadParcelWorkspace(db.runtime, ctx, "PRED-YYY-001")).rejects.toBeInstanceOf(
      NotFound,
    );
  });

  it("an unknown code is not found", async () => {
    const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
    await expect(loadParcelWorkspace(db.runtime, ctx, "PRED-ZZZ-999")).rejects.toBeInstanceOf(
      NotFound,
    );
  });

  it("D-015: a tenant ADMIN without a project membership is denied", async () => {
    const ctx = await contextFor(w.adminA, w.tenantA.slug, w.projectX.slug);
    await expect(loadParcelWorkspace(db.runtime, ctx, "PRED-XXX-001")).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });
});
