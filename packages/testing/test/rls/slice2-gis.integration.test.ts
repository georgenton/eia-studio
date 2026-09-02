import { gisSchema } from "@eia/db";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asContext,
  attempt,
  countVisible,
  createParcelWithGeometry,
  createProvenanceRecord,
  createSpatialDatasetVersion,
  getTestDatabase,
  resetDatabase,
  RLS_VIOLATION,
  seedTwoTenantWorld,
  squareAround,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * Slice 2 · isolation and storage rules of the spatial tables.
 *
 * Geometry is the most tempting thing to leak: a map endpoint that forgets a predicate returns
 * another tenant's parcels as a picture. These assertions are made in the database, where no
 * application bug can weaken them, and cover the storage invariants (SRID, validity, one active
 * version, one active geometry) that keep the layer legend and the areas honest.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let provX: string;
let provZ: string;
let versionX: string;
let parcelX: string;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);

  provX = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;
  const vX = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: provX,
  });
  versionX = vX.id;
  parcelX = (
    await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: provX,
      datasetVersionId: versionX,
      parcelCode: "PRED-AAA-001",
    })
  ).parcelId;

  provZ = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantB.id,
      projectId: w.projectZ.id,
    })
  ).id;
  const vZ = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provZ,
  });
  await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantB.id,
    projectId: w.projectZ.id,
    provenanceId: provZ,
    datasetVersionId: vZ.id,
    // The same business code in another tenant: codes are unique per project, never globally.
    parcelCode: "PRED-AAA-001",
  });
});
afterAll(() => db.close());

const memberA = (projectId: string | null) => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId,
});
const adminA = (projectId: string | null) => ({
  userId: w.adminA.id,
  tenantId: w.tenantA.id,
  projectId,
});
const ownerA = (projectId: string | null) => ({
  userId: w.ownerA.id,
  tenantId: w.tenantA.id,
  projectId,
});

const GIS_TABLES = [
  "app.spatial_dataset",
  "app.spatial_dataset_version",
  "app.parcel",
  "app.parcel_geometry",
] as const;

describe("Slice 2 · geometry is isolated by tenant and project", () => {
  it("a member of tenant A sees no spatial row of tenant B", async () => {
    for (const table of GIS_TABLES) {
      expect(
        await countVisible(db.runtime, memberA(w.projectX.id), table, {
          column: "tenant_id",
          value: w.tenantB.id,
        }),
        table,
      ).toBe(0);
    }
  });

  it("a member sees the geometry of the project they are assigned to", async () => {
    expect(
      await countVisible(db.runtime, memberA(w.projectX.id), "app.parcel_geometry"),
    ).toBeGreaterThan(0);
  });

  it("guessing another project's parcel code returns nothing, not someone else's parcel", async () => {
    const rows = await asContext(db.runtime, memberA(w.projectX.id), (tx) =>
      tx.execute(sql`select id from app.parcel where parcel_code = 'PRED-AAA-001'`),
    );
    // The identical code exists in tenant B too; only the row of the caller's project is visible.
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as { id: string }).id).toBe(parcelX);
  });

  it("D-015: a tenant ADMIN without a project membership reads no geometry", async () => {
    for (const table of GIS_TABLES) {
      expect(await countVisible(db.runtime, adminA(w.projectX.id), table), table).toBe(0);
      expect(await countVisible(db.runtime, adminA(null), table), table).toBe(0);
    }
  });

  it("D-015: a tenant OWNER reads geometry through implicit access", async () => {
    expect(
      await countVisible(db.runtime, ownerA(w.projectX.id), "app.parcel_geometry"),
    ).toBeGreaterThan(0);
  });

  it("without any context every spatial table is empty", async () => {
    for (const table of GIS_TABLES) {
      expect(
        await countVisible(db.runtime, { userId: null, tenantId: null, projectId: null }, table),
        table,
      ).toBe(0);
    }
  });

  it("a spatial query cannot be used to reach across the boundary", async () => {
    // Both tenants' parcels sit inside this box (the factory places them at the same spot), and
    // the query filters on nothing else: only RLS stands between the caller and the other rows.
    const rows = await asContext(db.runtime, memberA(w.projectX.id), (tx) =>
      tx.execute(sql`
        select count(*)::int as n
        from app.parcel_geometry
        where ST_Intersects(geom, ST_MakeEnvelope(-79.5, -4.5, -78.5, -3.5, 4326))
      `),
    );
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });
});

describe("Slice 2 · cross-tenant writes are rejected", () => {
  it("inserting a parcel into another tenant is denied by WITH CHECK", async () => {
    const error = await attempt(
      asContext(db.runtime, memberA(w.projectX.id), (tx) =>
        tx.insert(gisSchema.parcel).values({
          id: randomUUID(),
          tenantId: w.tenantB.id,
          projectId: w.projectZ.id,
          parcelCode: "PRED-BBB-001",
          side: "left",
          status: "confirmed",
          provenanceId: provZ,
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });

  it("inserting geometry into a project of the same tenant one is not assigned to is denied", async () => {
    const error = await attempt(
      asContext(db.runtime, memberA(w.projectX.id), (tx) =>
        tx.insert(gisSchema.parcel).values({
          id: randomUUID(),
          tenantId: w.tenantA.id,
          projectId: w.projectY.id,
          parcelCode: "PRED-CCC-001",
          side: "left",
          status: "confirmed",
          provenanceId: provX,
        }),
      ),
    );
    expect(error).toMatch(RLS_VIOLATION);
  });
});

describe("Slice 2 · PostGIS storage invariants", () => {
  it("stores canonical geometry in EPSG:4326, not in any project's UTM zone", async () => {
    // The IG2-001 regression: 0009 typed these columns `geometry(...,32717)`, which made one
    // pilot's zone a property of the platform.
    const rows = await db.migrator.execute(sql`
      select f_table_name as table_name, srid, type
      from geometry_columns where f_table_schema = 'app' order by 1
    `);
    expect(rows.rows).toHaveLength(3);
    for (const row of rows.rows as unknown as ReadonlyArray<{ table_name: string; srid: number }>) {
      expect(row.srid, row.table_name).toBe(4326);
    }
  });

  it("measures metres by transforming into the dataset's analysis CRS, never in degrees", async () => {
    const rows = await db.migrator.execute(sql`
      select ST_SRID(g.geom) as srid,
             GeometryType(g.geom) as type,
             ST_Area(g.geom) as degrees_area,
             ST_Area(ST_Transform(g.geom, v.analysis_srid)) as metric_area,
             g.area_m2::float8 as recorded,
             v.analysis_srid,
             v.source_srid
      from app.parcel_geometry g
      join app.spatial_dataset_version v
        on v.tenant_id = g.tenant_id and v.id = g.dataset_version_id
      where g.parcel_id = ${parcelX} and g.is_active
    `);
    const row = rows.rows[0] as {
      srid: number;
      type: string;
      degrees_area: number;
      metric_area: number;
      recorded: number;
      analysis_srid: number;
      source_srid: number;
    };
    expect(row.srid).toBe(4326);
    expect(row.type).toBe("POLYGON");
    expect(row.analysis_srid).toBe(32717);
    expect(row.source_srid).toBe(4326);
    // The whole point of the analysis CRS: the same polygon is ~4,9 ha in metres and a
    // meaningless 0,000004 in square degrees.
    expect(row.metric_area).toBeGreaterThan(40_000);
    expect(row.metric_area).toBeLessThan(60_000);
    expect(row.degrees_area).toBeLessThan(0.001);
    expect(row.recorded).toBeCloseTo(row.metric_area, 1);
  });

  it("a second project may declare a different analysis CRS without any schema change", async () => {
    // Project Y stands in for a project outside the pilot's UTM zone. Under 0009 this row could
    // not have existed at all.
    const provY = (
      await createProvenanceRecord(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectY.id,
      })
    ).id;
    const versionY = await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
      provenanceId: provY,
      // UTM 18S — a neighbouring zone, and a different official EPSG code.
      analysisSrid: 32718,
      sourceSrid: 32718,
    });
    const { parcelId } = await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
      provenanceId: provY,
      datasetVersionId: versionY.id,
      parcelCode: "PRED-YYY-777",
      // Inside zone 18S.
      lon: -75.2,
      lat: -6.1,
      analysisSrid: 32718,
    });

    const rows = await db.migrator.execute(sql`
      select ST_SRID(g.geom) as srid,
             v.analysis_srid,
             g.area_m2::float8 as recorded
      from app.parcel_geometry g
      join app.spatial_dataset_version v
        on v.tenant_id = g.tenant_id and v.id = g.dataset_version_id
      where g.parcel_id = ${parcelId}
    `);
    const row = rows.rows[0] as { srid: number; analysis_srid: number; recorded: number };
    // Same canonical storage, different analysis CRS, both projects in the same tables.
    expect(row.srid).toBe(4326);
    expect(row.analysis_srid).toBe(32718);
    expect(row.recorded).toBeGreaterThan(40_000);
    expect(row.recorded).toBeLessThan(60_000);
  });

  it("refuses a geographic CRS as an analysis CRS", async () => {
    const error = await attempt(
      createSpatialDatasetVersion(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        provenanceId: provX,
        versionLabel: "parcels_bad_crs",
        isActive: false,
        analysisSrid: 4326,
      }),
    );
    expect(error).toMatch(/analysis_srid_projected/i);
  });

  it("refuses geometry in the wrong SRID rather than storing it silently", async () => {
    const wkt = squareAround(-78.93, -4.07);
    const error = await attempt(
      db.migrator.execute(sql`
        insert into app.parcel_geometry
          (id, tenant_id, project_id, parcel_id, dataset_version_id, geom, area_m2, is_active,
           provenance_id)
        values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${parcelX},
                ${versionX}, ST_GeomFromText(${wkt}, 32717), 1, false, ${provX})
      `),
    );
    expect(error).toMatch(/srid|geometry/i);
  });

  it("refuses an invalid polygon", async () => {
    // A bow tie on the corridor: self-intersecting, so its area means nothing.
    const bowTie =
      "POLYGON((-78.93 -4.07, -78.92 -4.06, -78.92 -4.07, -78.93 -4.06, -78.93 -4.07))";
    const error = await attempt(
      db.migrator.execute(sql`
        insert into app.parcel_geometry
          (id, tenant_id, project_id, parcel_id, dataset_version_id, geom, area_m2, is_active,
           provenance_id)
        values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${parcelX},
                ${versionX}, ST_GeomFromText(${bowTie}, 4326), 1, false,
                ${provX})
      `),
    );
    expect(error).toMatch(/valid/i);
  });

  it("allows only one active geometry per parcel", async () => {
    const second = await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: provX,
      versionLabel: "parcels_dup",
      isActive: false,
    });
    const error = await attempt(
      createParcelWithGeometry(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        provenanceId: provX,
        datasetVersionId: second.id,
        parcelId: parcelX,
        isActive: true,
      }),
    );
    expect(error).toMatch(/parcel_geometry_one_active/i);
  });

  it("allows only one active version per dataset", async () => {
    const error = await attempt(
      createSpatialDatasetVersion(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        provenanceId: provX,
        versionLabel: "parcels_v_conflict",
        isActive: true,
      }),
    );
    expect(error).toMatch(/spatial_dataset_version_one_active/i);
  });

  it("replacing geometry keeps the parcel's identity and its business code", async () => {
    // The official import path in miniature: deactivate the old geometry, activate the new one.
    const replacement = await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: provX,
      versionLabel: "parcels_v_official",
      origin: "imported",
      generatorVersion: null,
      isActive: false,
      supersedesVersionId: versionX,
    });
    await db.migrator.execute(sql`
      update app.parcel_geometry set is_active = false
      where tenant_id = ${w.tenantA.id} and parcel_id = ${parcelX} and is_active
    `);
    const { parcelId, geometryId } = await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: provX,
      datasetVersionId: replacement.id,
      parcelId: parcelX,
      lon: -78.94,
      isActive: true,
    });

    expect(parcelId).toBe(parcelX);
    const rows = await db.migrator.execute(sql`
      select p.parcel_code,
             (select count(*)::int from app.parcel_geometry g
               where g.tenant_id = p.tenant_id and g.parcel_id = p.id) as versions,
             (select g.id from app.parcel_geometry g
               where g.tenant_id = p.tenant_id and g.parcel_id = p.id and g.is_active) as active
      from app.parcel p where p.id = ${parcelX}
    `);
    const row = rows.rows[0] as { parcel_code: string; versions: number; active: string };
    expect(row.parcel_code).toBe("PRED-AAA-001");
    // The superseded geometry is kept, so a figure computed from it stays explainable.
    expect(row.versions).toBeGreaterThan(1);
    expect(row.active).toBe(geometryId);
  });

  it("refuses a chainage without a method, and a method without a chainage", async () => {
    for (const values of [
      sql`${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, 'PRED-DDD-001', 'left', 'confirmed', 120.0, null, ${provX}`,
      sql`${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, 'PRED-DDD-002', 'left', 'confirmed', null, 'declared', ${provX}`,
    ]) {
      const error = await attempt(
        db.migrator.execute(sql`
          insert into app.parcel
            (id, tenant_id, project_id, parcel_code, side, status, chainage_m, chainage_method,
             provenance_id)
          values (${values})
        `),
      );
      expect(error).toMatch(/chainage/i);
    }
  });

  it("refuses a parcel code that is not a business identifier", async () => {
    const error = await attempt(
      db.migrator.execute(sql`
        insert into app.parcel (id, tenant_id, project_id, parcel_code, side, status, provenance_id)
        values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, 'maría pérez', 'left',
                'confirmed', ${provX})
      `),
    );
    expect(error).toMatch(/parcel_code_shape/i);
  });
});
