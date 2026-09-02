import { appSchema } from "@eia/db";
import { selectLayerByKind, type SessionUser } from "@eia/domain";
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
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildRequestContext, loadParcelExplorer, loadTerritorialSummary } from "../src/index";

/**
 * Chainage semantics (IG2-003) and deterministic layer order (IG2-007), proven against PostGIS
 * rather than against the generator's own arithmetic.
 *
 * The fixture here is a straight east–west alignment of a known length, so the expected chainage
 * of each parcel can be stated by hand rather than read back from the code under test.
 */
const session = (user: { id: string; email: string }): SessionUser => ({
  subject: user.id,
  email: user.email,
  name: null,
  emailVerified: true,
});

const db = getTestDatabase();
let w: TwoTenantWorld;
let provenanceId: string;
let alignmentLengthM: number;
/**
 * Inlined with `sql.raw`, not bound: a bound parameter reaches PostGIS as text and `ST_Transform`
 * then tries to read "32717" as a proj string. It is a constant in this file, never user input.
 */
const ANALYSIS_SRID = sql.raw("32717");

/** The one chainage derivation, as the seeder performs it. */
async function deriveChainage(projectId: string, tenantId: string) {
  return db.migrator.execute(sql`
    with axis as (
      select ST_Transform(a.geom, ${ANALYSIS_SRID}) as geom,
             ST_Length(ST_Transform(a.geom, ${ANALYSIS_SRID})) as length_m
      from app.alignment a
      join app.spatial_dataset_version v
        on v.tenant_id = a.tenant_id and v.id = a.dataset_version_id and v.is_active
      where a.tenant_id = ${tenantId} and a.project_id = ${projectId}
      limit 1
    )
    update app.parcel p
       set chainage_m = round((
             ST_LineLocatePoint(axis.geom, ST_Centroid(ST_Transform(g.geom, ${ANALYSIS_SRID})))
             * axis.length_m
           )::numeric, 1),
           chainage_method = 'centroid_projection'
      from app.parcel_geometry g, axis
     where g.tenant_id = p.tenant_id and g.parcel_id = p.id and g.is_active
       and p.tenant_id = ${tenantId} and p.project_id = ${projectId}
    returning p.id, p.parcel_code, p.chainage_m
  `);
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of ["core.projects", "gis.maps", "gis.parcels"] as const) {
    await db.migrator
      .insert(appSchema.tenantCapability)
      .values({ tenantId: w.tenantA.id, capabilityKey: key, entitled: true, enabled: true })
      .onConflictDoNothing();
  }
  provenanceId = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;

  // Datasets are created affectations → parcels → alignment, i.e. the reverse of reading order,
  // so a test that depends on insertion order fails rather than passing by luck.
  const affectationsVersion = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId,
    kind: "affectations",
    versionLabel: "affectations_v1",
    isActive: true,
  });
  const parcelsVersion = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId,
    kind: "parcels",
    versionLabel: "parcels_v1",
    isActive: true,
  });
  const alignmentVersion = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId,
    kind: "alignment",
    versionLabel: "alignment_v1",
    isActive: true,
  });

  // A straight east–west line at latitude −4, from −79,00 to −78,90: about 11,1 km.
  await db.migrator.execute(sql`
    insert into app.alignment
      (id, tenant_id, project_id, dataset_version_id, label, geom, length_m, provenance_id)
    values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${alignmentVersion.id},
            'Eje de prueba',
            ST_GeomFromText('LINESTRING(-79.00 -4.00, -78.90 -4.00)', 4326),
            ST_Length(ST_Transform(
              ST_GeomFromText('LINESTRING(-79.00 -4.00, -78.90 -4.00)', 4326), ${ANALYSIS_SRID})),
            ${provenanceId})
  `);
  const lengthRow = await db.migrator.execute(sql`
    select length_m::float8 as length from app.alignment where project_id = ${w.projectX.id}
  `);
  alignmentLengthM = (lengthRow.rows[0] as { length: number }).length;

  // Five parcels spread along the line, deliberately created out of order.
  for (const [code, lon] of [
    ["PRED-CHN-003", -78.95],
    ["PRED-CHN-001", -78.99],
    ["PRED-CHN-005", -78.905],
    ["PRED-CHN-002", -78.97],
    ["PRED-CHN-004", -78.93],
  ] as const) {
    await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId,
      datasetVersionId: parcelsVersion.id,
      parcelCode: code,
      lon,
      lat: -4.0,
    });
  }
  void affectationsVersion;
  await deriveChainage(w.projectX.id, w.tenantA.id);
});
afterAll(() => db.close());

const ctxFor = (user: { id: string; email: string }) =>
  buildRequestContext(db.runtime, {
    sessionUser: session(user),
    tenantSlug: w.tenantA.slug,
    projectSlug: w.projectX.slug,
  });

async function chainages() {
  const rows = await db.migrator.execute(sql`
    select parcel_code, chainage_m::float8 as chainage, chainage_method
    from app.parcel where project_id = ${w.projectX.id} order by parcel_code
  `);
  return rows.rows as unknown as ReadonlyArray<{
    parcel_code: string;
    chainage: number;
    chainage_method: string;
  }>;
}

describe("chainage is derived from geometry (IG2-003)", () => {
  it("records the method it was obtained by, on every value", async () => {
    for (const row of await chainages()) {
      expect(row.chainage_method, row.parcel_code).toBe("centroid_projection");
    }
  });

  it("lies between zero and the active alignment's length", async () => {
    expect(alignmentLengthM).toBeGreaterThan(10_000);
    for (const row of await chainages()) {
      expect(row.chainage, row.parcel_code).toBeGreaterThanOrEqual(0);
      expect(row.chainage, row.parcel_code).toBeLessThanOrEqual(alignmentLengthM);
    }
  });

  it("orders parcels along the corridor, whatever order they were created in", async () => {
    const byCode = await chainages();
    const values = byCode.map((r) => r.chainage);
    // The codes were assigned west→east; the rows were inserted in a scrambled order.
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  it("puts each parcel where the geometry says, to within a metre", async () => {
    // The line runs from −79,00 to −78,90 at a constant latitude, so the expected station is the
    // fraction of the way east times the line's length. Computed here from the input longitudes,
    // not from the value under test.
    const expected = (lon: number) => ((lon - -79.0) / (-78.9 - -79.0)) * alignmentLengthM;
    const rows = Object.fromEntries((await chainages()).map((r) => [r.parcel_code, r.chainage]));
    expect(rows["PRED-CHN-001"]).toBeCloseTo(expected(-78.99), 0);
    expect(rows["PRED-CHN-003"]).toBeCloseTo(expected(-78.95), 0);
    expect(rows["PRED-CHN-005"]).toBeCloseTo(expected(-78.905), 0);
  });

  it("is deterministic: recomputing changes nothing", async () => {
    const before = await chainages();
    await deriveChainage(w.projectX.id, w.tenantA.id);
    expect(await chainages()).toEqual(before);
  });

  it("is a reference, never identity: a new parcel id does not move the chainage", async () => {
    const [sample] = await chainages();
    const rows = await db.migrator.execute(sql`
      select id from app.parcel
      where project_id = ${w.projectX.id} and parcel_code = ${sample!.parcel_code}
    `);
    const oldId = (rows.rows[0] as { id: string }).id;

    // Re-create the same parcel under a fresh UUID with the same geometry and the same code.
    await db.migrator.execute(sql`
      delete from app.parcel where id = ${oldId}
    `);
    const parcelsVersionRows = await db.migrator.execute(sql`
      select v.id from app.spatial_dataset_version v
      join app.spatial_dataset d on d.tenant_id = v.tenant_id and d.id = v.dataset_id
      where v.project_id = ${w.projectX.id} and d.kind = 'parcels' and v.is_active
    `);
    const { parcelId: newId } = await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId,
      datasetVersionId: (parcelsVersionRows.rows[0] as { id: string }).id,
      parcelCode: sample!.parcel_code,
      lon: -78.99,
      lat: -4.0,
    });
    await deriveChainage(w.projectX.id, w.tenantA.id);

    const after = (await chainages()).find((r) => r.parcel_code === sample!.parcel_code);
    expect(newId).not.toBe(oldId);
    expect(after?.chainage).toBeCloseTo(sample!.chainage, 1);
  });
});

describe("layer order does not depend on the database (IG2-007)", () => {
  it("the territorial summary names the parcels dataset, not whichever row came first", async () => {
    const ctx = await ctxFor(w.memberA);
    const summary = await loadTerritorialSummary(db.runtime, ctx);
    expect(summary).not.toBeNull();
    const layer = selectLayerByKind(summary!.layers, "parcels");
    expect(layer?.datasetKind).toBe("parcels");
    expect(layer?.versionLabel).toBe("parcels_v1");
    expect(layer?.legend).toBe("SYNTHETIC_PARCELS");
  });

  it("returns layers in a stable order however the rows were inserted", async () => {
    // The datasets were inserted affectations → parcels → alignment in `beforeAll`. The read
    // model returns them in the declared kind order instead, which is the point: the answer comes
    // from an explicit ORDER BY, not from what the heap happened to hold.
    const ctx = await ctxFor(w.memberA);
    const first = await loadParcelExplorer(db.runtime, ctx);
    expect(first.layers.map((l) => l.datasetKind)).toEqual([
      "alignment",
      "parcels",
      "affectations",
    ]);

    // Rewriting every row (a vacuum, a replication catch-up, a different plan) must not change it.
    await db.migrator.execute(sql`
      update app.spatial_dataset_version set note = coalesce(note, '') || ' '
      where project_id = ${w.projectX.id}
    `);
    const second = await loadParcelExplorer(db.runtime, ctx);
    expect(second.layers.map((l) => l.datasetKind)).toEqual(first.layers.map((l) => l.datasetKind));
    const summary = await loadTerritorialSummary(db.runtime, ctx);
    expect(summary!.layers.map((l) => l.datasetKind)).toEqual(
      first.layers.map((l) => l.datasetKind),
    );
  });

  it("gives the same provenance badge before and after a row rewrite", async () => {
    const ctx = await ctxFor(w.memberA);
    const before = selectLayerByKind(
      (await loadTerritorialSummary(db.runtime, ctx))!.layers,
      "parcels",
    );
    await db.migrator.execute(sql`
      update app.spatial_dataset_version set feature_count = feature_count
      where project_id = ${w.projectX.id}
    `);
    const after = selectLayerByKind(
      (await loadTerritorialSummary(db.runtime, ctx))!.layers,
      "parcels",
    );
    expect(after?.provenanceId).toBe(before?.provenanceId);
    expect(after?.legend).toBe(before?.legend);
  });
});
