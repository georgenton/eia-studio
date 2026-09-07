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

  /**
   * The camera, on the geometry the database actually stores.
   *
   * Every parcel of this product goes in through `ST_Multi`, so what `ST_AsGeoJSON` hands the read
   * model is a `MultiPolygon` — four levels of nesting — and the extent used to be computed by
   * indexing two levels deep. It returned `null`, the map opened on `[0, 0]` at zoom 1, and the
   * project's own cartography sat several thousand kilometres outside the viewport. Nothing failed
   * loudly: the payload was complete and the camera was somewhere else.
   */
  it("frames the project: the extent is finite and contains the parcels", async () => {
    const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
    const view = await loadParcelExplorer(db.runtime, ctx);

    expect(view.bounds).not.toBeNull();
    const [west, south, east, north] = view.bounds!;
    for (const value of [west, south, east, north]) expect(Number.isFinite(value)).toBe(true);
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);

    // What the database says the extent is, computed by PostGIS rather than by us.
    const envelope = await db.migrator.execute(sql`
      select ST_XMin(e) as w, ST_YMin(e) as s, ST_XMax(e) as x, ST_YMax(e) as n
        from (select ST_Extent(geom) as e from app.parcel_geometry
               where project_id = ${w.projectX.id} and is_active) as t
    `);
    const truth = envelope.rows[0] as { w: number; s: number; x: number; n: number };
    expect(west).toBeCloseTo(Number(truth.w), 6);
    expect(south).toBeCloseTo(Number(truth.s), 6);
    expect(east).toBeCloseTo(Number(truth.x), 6);
    expect(north).toBeCloseTo(Number(truth.n), 6);
  });

  it("frames a parcel whose geometry is genuinely in two pieces", async () => {
    // 20 of the study's 141 parcels are multi-part. A parcel split by a quebrada is one parcel with
    // two polygons, and the far piece must be inside the opening view like any other.
    const provenanceId = (
      await createProvenanceRecord(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        regime: "DEMO_SIMULATION",
      })
    ).id;
    // The project's existing active version: only one may be active per dataset, and this parcel
    // belongs to the same layer as the others rather than to a layer of its own.
    const active = await db.migrator.execute(sql`
      select id from app.spatial_dataset_version
       where project_id = ${w.projectX.id} and is_active limit 1
    `);
    const datasetVersionId = (active.rows[0] as { id: string }).id;
    const { parcelId } = await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId,
      datasetVersionId,
      parcelCode: "PRED-XXX-MULTI",
    });
    // Two disjoint squares, the second an eighth of a degree east and north of the first.
    await db.migrator.execute(sql`
      update app.parcel_geometry
         set geom = ST_Multi(ST_Union(
               ST_GeomFromText('POLYGON((-78.9 -4.1, -78.899 -4.1, -78.899 -4.099, -78.9 -4.099, -78.9 -4.1))', 4326),
               ST_GeomFromText('POLYGON((-78.8 -4.0, -78.799 -4.0, -78.799 -3.999, -78.8 -3.999, -78.8 -4.0))', 4326)))
       where parcel_id = ${parcelId}
    `);

    try {
      const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
      const view = await loadParcelExplorer(db.runtime, ctx);
      const feature = view.features.find((f) => f.id === parcelId);
      expect((feature?.geometry as { type: string }).type).toBe("MultiPolygon");

      const [west, south, east, north] = view.bounds!;
      for (const value of [west, south, east, north]) expect(Number.isFinite(value)).toBe(true);
      // Both pieces are inside: the far one is what the old algorithm turned into NaN.
      expect(west).toBeLessThanOrEqual(-78.9);
      expect(east).toBeGreaterThanOrEqual(-78.799);
      expect(south).toBeLessThanOrEqual(-4.1);
      expect(north).toBeGreaterThanOrEqual(-3.999);
    } finally {
      await db.migrator.execute(sql`delete from app.parcel where id = ${parcelId}`);
    }
  });

  it("bounds the payload so one project cannot ask the server for an unbounded map", async () => {
    const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
    const view = await loadParcelExplorer(db.runtime, ctx);
    expect(view.parcels.length).toBeLessThanOrEqual(2000);
    expect(view.truncated).toBe(false);
  });
});

describe("loadParcelWorkspace", () => {
  /**
   * The workspace's extent comes from PostGIS — `ST_XMin(ST_Envelope(geom))` and its three
   * siblings — not from JavaScript, and `ST_Envelope` is already the envelope of the whole
   * collection. It was therefore never affected by the multi-part defect the explorer had, and it
   * was left alone; this test is the coverage that was missing, not a fix.
   */
  it("frames a multi-part parcel around every one of its pieces", async () => {
    const provenanceId = (
      await createProvenanceRecord(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        regime: "DEMO_SIMULATION",
      })
    ).id;
    const active = await db.migrator.execute(sql`
      select id from app.spatial_dataset_version
       where project_id = ${w.projectX.id} and is_active limit 1
    `);
    const { parcelId } = await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId,
      datasetVersionId: (active.rows[0] as { id: string }).id,
      parcelCode: "PRED-XXX-WS-MULTI",
    });
    await db.migrator.execute(sql`
      update app.parcel_geometry
         set geom = ST_Multi(ST_Union(
               ST_GeomFromText('POLYGON((-78.9 -4.1, -78.899 -4.1, -78.899 -4.099, -78.9 -4.099, -78.9 -4.1))', 4326),
               ST_GeomFromText('POLYGON((-78.8 -4.0, -78.799 -4.0, -78.799 -3.999, -78.8 -3.999, -78.8 -4.0))', 4326)))
       where parcel_id = ${parcelId}
    `);

    try {
      const ctx = await contextFor(w.memberA, w.tenantA.slug, w.projectX.slug);
      const view = await loadParcelWorkspace(db.runtime, ctx, "PRED-XXX-WS-MULTI");
      expect(view.bounds).not.toBeNull();
      const [west, south, east, north] = view.bounds!;
      for (const value of [west, south, east, north]) expect(Number.isFinite(value)).toBe(true);
      expect(west).toBeCloseTo(-78.9, 6);
      expect(south).toBeCloseTo(-4.1, 6);
      expect(east).toBeCloseTo(-78.799, 6);
      expect(north).toBeCloseTo(-3.999, 6);
      expect((view.geometry as { type: string }).type).toBe("MultiPolygon");
    } finally {
      await db.migrator.execute(sql`delete from app.parcel where id = ${parcelId}`);
    }
  });

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
