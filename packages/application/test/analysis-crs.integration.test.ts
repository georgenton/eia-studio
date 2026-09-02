import { appSchema } from "@eia/db";
import {
  createParcelWithGeometry,
  createProvenanceRecord,
  createSpatialDatasetVersion,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  attempt,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AnalysisCrsUnusable,
  assertAnalysisSridUsable,
  assertSourceSridUsable,
  inspectAnalysisSrid,
} from "../src/index";

/**
 * Analysis-CRS validation (IG2-009), read from `spatial_ref_sys` and never from the SRID number.
 *
 * The cases below are the point of the whole exercise. `EPSG:4087` is projected and metre-based
 * *inside* the 4xxx block, and `EPSG:6318` is geographic *outside* it, so any rule based on the
 * numeric range gets both wrong — and getting 6318 wrong means every stored area is silently
 * square degrees.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of ["core.projects", "gis.maps", "gis.parcels"] as const) {
    await db.migrator
      .insert(appSchema.tenantCapability)
      .values({ tenantId: w.tenantA.id, capabilityKey: key, entitled: true, enabled: true })
      .onConflictDoNothing();
  }
});
afterAll(() => db.close());

describe("a CRS is judged by its definition, not by its number", () => {
  const accepted: ReadonlyArray<[number, string]> = [
    [32717, "UTM zone 17S — the pilot's own CRS"],
    [32718, "UTM zone 18S — a neighbouring project's"],
    [4087, "World Equidistant Cylindrical — projected and metric INSIDE the 4xxx block"],
    [3857, "Web Mercator"],
  ];

  const rejected: ReadonlyArray<[number, string, RegExp]> = [
    [4326, "WGS 84 — geographic, degrees", /not a projected, metre-based CRS/],
    [6318, "NAD83(2011) — geographic OUTSIDE the 4xxx block", /not a projected, metre-based CRS/],
    [2225, "California zone 1 — projected but in US survey feet", /not a projected, metre-based/],
    [999_999, "not registered anywhere", /not registered in spatial_ref_sys/],
  ];

  for (const [srid, why] of accepted) {
    it(`accepts EPSG:${srid} (${why})`, async () => {
      await expect(assertAnalysisSridUsable(db.migrator, srid)).resolves.toBe(srid);
      const check = await inspectAnalysisSrid(db.migrator, srid);
      expect(check.registered).toBe(true);
      expect(check.metricProjected).toBe(true);
    });
  }

  for (const [srid, why, message] of rejected) {
    it(`rejects EPSG:${srid} (${why})`, async () => {
      await expect(assertAnalysisSridUsable(db.migrator, srid)).rejects.toBeInstanceOf(
        AnalysisCrsUnusable,
      );
      await expect(assertAnalysisSridUsable(db.migrator, srid)).rejects.toThrow(message);
    });
  }

  it("explains the refusal instead of surfacing a PostGIS exception", async () => {
    const error = await assertAnalysisSridUsable(db.migrator, 6318).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnalysisCrsUnusable);
    const message = (error as Error).message;
    expect(message).toContain("EPSG:6318");
    // Names the CRS and says what the consequence would be, in one sentence.
    expect(message).toMatch(/geographic CRS would make them degrees/);
    expect(message).not.toMatch(/ST_Transform\(|SQLSTATE|syntax error/);
  });

  it("refuses something that is not an SRID at all", async () => {
    for (const value of [0, -32717, 1.5]) {
      await expect(assertAnalysisSridUsable(db.migrator, value)).rejects.toBeInstanceOf(
        AnalysisCrsUnusable,
      );
    }
  });

  it("a source CRS need not be projected — it describes where the data came from", async () => {
    // An official package delivered in a geographic CRS is perfectly normal; it just has to be
    // something PostGIS knows, or the transform to canonical storage cannot be explained later.
    await expect(assertSourceSridUsable(db.migrator, 4326)).resolves.toBe(4326);
    await expect(assertSourceSridUsable(db.migrator, 6318)).resolves.toBe(6318);
    await expect(assertSourceSridUsable(db.migrator, 32717)).resolves.toBe(32717);
    await expect(assertSourceSridUsable(db.migrator, 999_999)).rejects.toThrow(/not registered/);
  });
});

describe("the database refuses the same values underneath the application", () => {
  const insertVersion = async (analysisSrid: number, sourceSrid = 4326) =>
    attempt(
      createSpatialDatasetVersion(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        provenanceId: (
          await createProvenanceRecord(db.migrator, {
            tenantId: w.tenantA.id,
            projectId: w.projectX.id,
          })
        ).id,
        versionLabel: `crs_${analysisSrid}_${sourceSrid}_${Math.random().toString(36).slice(2, 8)}`,
        isActive: false,
        analysisSrid,
        sourceSrid,
      }),
    );

  it("accepts a projected metre-based analysis CRS, including 4087", async () => {
    for (const srid of [32717, 32718, 4087, 3857]) {
      expect(await insertVersion(srid), `EPSG:${srid}`).toBeNull();
    }
  });

  it("rejects a geographic analysis CRS, inside or outside the 4xxx block", async () => {
    for (const srid of [4326, 6318]) {
      expect(await insertVersion(srid), `EPSG:${srid}`).toMatch(
        /analysis_crs_not_metric_projected/,
      );
    }
  });

  it("rejects a projected analysis CRS that is not metre-based", async () => {
    expect(await insertVersion(2225)).toMatch(/analysis_crs_not_metric_projected/);
  });

  it("rejects an unregistered analysis CRS", async () => {
    expect(await insertVersion(999_999)).toMatch(/analysis_crs_not_metric_projected/);
  });

  it("rejects an unregistered source CRS but allows a geographic one", async () => {
    expect(await insertVersion(32717, 6318)).toBeNull();
    expect(await insertVersion(32717, 999_999)).toMatch(/analysis_crs_unknown_source/);
  });

  it("no numeric-range CHECK remains on either SRID column", async () => {
    const rows = await db.migrator.execute(sql`
      select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'app.spatial_dataset_version'::regclass and contype = 'c'
    `);
    for (const row of rows.rows as unknown as ReadonlyArray<{ conname: string; def: string }>) {
      expect(row.def, row.conname).not.toMatch(/BETWEEN/i);
      expect(row.def, row.conname).not.toMatch(/srid/i);
    }
  });
});

describe("which CRS owns which measurement", () => {
  it("two projects use different analysis CRS in the same canonical 4326 tables", async () => {
    // Retained from IG2-001: canonical storage is shared, the metric CRS is not.
    for (const [project, analysisSrid, lon, lat] of [
      [w.projectX, 32717, -78.93, -4.07],
      [w.projectY, 32718, -75.2, -6.1],
    ] as const) {
      const provenanceId = (
        await createProvenanceRecord(db.migrator, {
          tenantId: w.tenantA.id,
          projectId: project.id,
        })
      ).id;
      const version = await createSpatialDatasetVersion(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: project.id,
        provenanceId,
        versionLabel: `parcels_${analysisSrid}`,
        analysisSrid,
        sourceSrid: analysisSrid,
        isActive: true,
      });
      await createParcelWithGeometry(db.migrator, {
        tenantId: w.tenantA.id,
        projectId: project.id,
        provenanceId,
        datasetVersionId: version.id,
        parcelCode: `PRED-CRS-${analysisSrid}`,
        lon,
        lat,
        analysisSrid,
      });
    }

    const rows = await db.migrator.execute(sql`
      select p.parcel_code, ST_SRID(g.geom) as srid, v.analysis_srid, g.area_m2::float8 as area
      from app.parcel_geometry g
      join app.parcel p on p.tenant_id = g.tenant_id and p.id = g.parcel_id
      join app.spatial_dataset_version v on v.tenant_id = g.tenant_id and v.id = g.dataset_version_id
      where p.parcel_code like 'PRED-CRS-%' order by p.parcel_code
    `);
    const parcels = rows.rows as unknown as ReadonlyArray<{
      parcel_code: string;
      srid: number;
      analysis_srid: number;
      area: number;
    }>;
    expect(parcels).toHaveLength(2);
    expect(parcels.map((p) => p.srid)).toEqual([4326, 4326]);
    expect(parcels.map((p) => p.analysis_srid)).toEqual([32717, 32718]);
    for (const parcel of parcels) {
      expect(parcel.area, parcel.parcel_code).toBeGreaterThan(40_000);
      expect(parcel.area, parcel.parcel_code).toBeLessThan(60_000);
    }
  });

  it("chainage is measured in the ALIGNMENT dataset's CRS, not the parcel layer's", async () => {
    // The ownership rule (IG2-009), made falsifiable: the alignment and the parcels are given
    // *different* valid metric CRS, which measure the same line differently — 11 107,7 m in
    // UTM 17S against 11 131,9 m in World Equidistant Cylindrical. A query that reached for the
    // parcel layer's CRS would produce the second number, so the assertion can tell them apart.
    const alignmentVersion = await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantB.id,
      projectId: w.projectZ.id,
      provenanceId: (
        await createProvenanceRecord(db.migrator, {
          tenantId: w.tenantB.id,
          projectId: w.projectZ.id,
        })
      ).id,
      kind: "alignment",
      versionLabel: "alignment_utm17s",
      analysisSrid: 32717,
      sourceSrid: 4326,
      isActive: true,
    });
    const parcelsVersion = await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantB.id,
      projectId: w.projectZ.id,
      provenanceId: (
        await createProvenanceRecord(db.migrator, {
          tenantId: w.tenantB.id,
          projectId: w.projectZ.id,
        })
      ).id,
      kind: "parcels",
      versionLabel: "parcels_eqc",
      // Also projected and metric, and also perfectly valid — just not the road's ruler.
      analysisSrid: 4087,
      sourceSrid: 4326,
      isActive: true,
    });

    const line = "LINESTRING(-79.00 -4.00, -78.90 -4.00)";
    await db.migrator.execute(sql`
      insert into app.alignment
        (id, tenant_id, project_id, dataset_version_id, label, geom, length_m, provenance_id)
      select gen_random_uuid(), ${w.tenantB.id}, ${w.projectZ.id}, ${alignmentVersion.id},
             'Eje con CRS propio',
             ST_GeomFromText(${line}, 4326),
             ST_Length(ST_Transform(ST_GeomFromText(${line}, 4326), v.analysis_srid)),
             v.provenance_id
      from app.spatial_dataset_version v where v.id = ${alignmentVersion.id}
    `);
    await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantB.id,
      projectId: w.projectZ.id,
      provenanceId: (
        await createProvenanceRecord(db.migrator, {
          tenantId: w.tenantB.id,
          projectId: w.projectZ.id,
        })
      ).id,
      datasetVersionId: parcelsVersion.id,
      parcelCode: "PRED-OWN-001",
      // Nine tenths of the way along the line.
      lon: -78.91,
      lat: -4.0,
      analysisSrid: 4087,
    });

    // The seeder's chainage query, verbatim in shape: the axis is joined to *its own* version row.
    await db.migrator.execute(sql`
      with axis as (
        select ST_Transform(a.geom, v.analysis_srid) as geom,
               v.analysis_srid as srid,
               ST_Length(ST_Transform(a.geom, v.analysis_srid)) as length_m
        from app.alignment a
        join app.spatial_dataset_version v
          on v.tenant_id = a.tenant_id and v.id = a.dataset_version_id and v.is_active
        where a.tenant_id = ${w.tenantB.id} and a.project_id = ${w.projectZ.id}
        limit 1
      )
      update app.parcel p
         set chainage_m = round((
               ST_LineLocatePoint(axis.geom, ST_Centroid(ST_Transform(g.geom, axis.srid)))
               * axis.length_m
             )::numeric, 1),
             chainage_method = 'centroid_projection'
        from app.parcel_geometry g, axis
       where g.tenant_id = p.tenant_id and g.parcel_id = p.id and g.is_active
         and p.tenant_id = ${w.tenantB.id} and p.project_id = ${w.projectZ.id}
    `);

    const rows = await db.migrator.execute(sql`
      select p.chainage_m::float8 as chainage,
             a.length_m::float8 as alignment_length,
             ST_Length(ST_Transform(a.geom, 4087)) as length_in_parcel_crs,
             ST_Length(ST_Transform(a.geom, 32717)) as length_in_alignment_crs
      from app.parcel p, app.alignment a
      where p.parcel_code = 'PRED-OWN-001' and a.project_id = ${w.projectZ.id}
    `);
    const row = rows.rows[0] as unknown as {
      chainage: number;
      alignment_length: number;
      length_in_parcel_crs: number;
      length_in_alignment_crs: number;
    };

    // The two rulers genuinely disagree, so this test can fail.
    expect(row.length_in_alignment_crs).not.toBeCloseTo(row.length_in_parcel_crs, 0);
    // The stored alignment length is the alignment CRS's answer.
    expect(row.alignment_length).toBeCloseTo(row.length_in_alignment_crs, 1);
    // And the chainage is 0,9 of *that* length, not of the parcel layer's.
    expect(row.chainage).toBeCloseTo(row.length_in_alignment_crs * 0.9, 0);
    expect(row.chainage).not.toBeCloseTo(row.length_in_parcel_crs * 0.9, 0);
  });
});
