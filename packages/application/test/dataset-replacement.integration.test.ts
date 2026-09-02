import { appSchema } from "@eia/db";
import { PermissionDenied, type SessionUser } from "@eia/domain";
import {
  attempt,
  createParcelWithGeometry,
  createProjectMembership,
  createProvenanceRecord,
  createSpatialDatasetVersion,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  squareAround,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { activateDatasetVersion, buildRequestContext, loadParcelExplorer } from "../src/index";

/**
 * The official replacement path (IG2-002), in miniature.
 *
 * The importer is not built. What is proven here is the step it will end with, because that is
 * where the invariants live: a synthetic dataset is replaced by an "imported" one, in one
 * transaction, and the parcel comes out the other side as the same row.
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
/** The parcels dataset, shared by the replacement tests so they act on one chain of versions. */
let parcelsDatasetId: string;
/** Activating a dataset is a write; only a role that may import geometry can do it. */
let gisSpecialist: { id: string; email: string };

/** State of the world, read with the migrator so RLS cannot mask a missing row. */
async function snapshot(projectId: string) {
  const versions = await db.migrator.execute(sql`
    select v.id, v.version_label, v.is_active, v.supersedes_version_id, d.kind
    from app.spatial_dataset_version v
    join app.spatial_dataset d on d.tenant_id = v.tenant_id and d.id = v.dataset_id
    where v.project_id = ${projectId}
    order by d.kind, v.version_label
  `);
  const geometries = await db.migrator.execute(sql`
    select g.id, g.parcel_id, g.dataset_version_id, g.is_active, p.parcel_code
    from app.parcel_geometry g
    join app.parcel p on p.tenant_id = g.tenant_id and p.id = g.parcel_id
    where g.project_id = ${projectId}
    order by g.created_at
  `);
  return {
    versions: versions.rows as unknown as ReadonlyArray<{
      id: string;
      version_label: string;
      is_active: boolean;
      supersedes_version_id: string | null;
      kind: string;
    }>,
    geometries: geometries.rows as unknown as ReadonlyArray<{
      id: string;
      parcel_id: string;
      dataset_version_id: string;
      is_active: boolean;
      parcel_code: string;
    }>,
  };
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

  gisSpecialist = await createUser(db.migrator, "gis-specialist");
  const membership = await createTenantMembership(db.migrator, {
    tenantId: w.tenantA.id,
    userId: gisSpecialist.id,
    role: "MEMBER",
  });
  await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    tenantMembershipId: membership.id,
    role: "GIS_SPECIALIST",
  });
});
afterAll(() => db.close());

const contextFor = (user: { id: string; email: string }) =>
  buildRequestContext(db.runtime, {
    sessionUser: session(user),
    tenantSlug: w.tenantA.slug,
    projectSlug: w.projectX.slug,
  });

describe("official dataset replacement", () => {
  it("replaces geometry in one transaction and leaves the parcel untouched", async () => {
    // --- v1: the synthetic dataset, active -----------------------------------------------
    const v1 = await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId,
      versionLabel: "parcels_v1",
      origin: "generated",
      isActive: true,
    });
    parcelsDatasetId = v1.datasetId;
    const { parcelId } = await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId,
      datasetVersionId: v1.id,
      parcelCode: "PRED-REP-001",
    });

    // The alignment lives in its own dataset and must stay active throughout: active-version
    // uniqueness is scoped to the dataset, not to the project.
    const alignmentV1 = await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId,
      kind: "alignment",
      versionLabel: "alignment_v1",
      isActive: true,
    });

    const before = await snapshot(w.projectX.id);
    expect(before.geometries).toHaveLength(1);
    expect(before.geometries[0]?.is_active).toBe(true);

    // --- v2: prepared against the SAME parcel, not yet active ----------------------------
    const v2 = await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId,
      versionLabel: "parcels_v2_official",
      origin: "imported",
      generatorVersion: null,
      isActive: false,
      supersedesVersionId: v1.id,
      datasetId: v1.datasetId,
    });
    const { parcelId: sameParcel, geometryId: geometryV2 } = await createParcelWithGeometry(
      db.migrator,
      {
        tenantId: w.tenantA.id,
        projectId: w.projectX.id,
        provenanceId,
        datasetVersionId: v2.id,
        parcelId,
        lon: -78.94,
        isActive: false,
      },
    );
    expect(sameParcel).toBe(parcelId);

    // --- activate ------------------------------------------------------------------------
    const ctx = await contextFor(gisSpecialist);
    const result = await activateDatasetVersion(db.runtime, ctx, v2.id);
    expect(result.datasetKind).toBe("parcels");
    expect(result.supersededVersionId).toBe(v1.id);
    expect(result.geometriesActivated).toBe(1);
    expect(result.geometriesSuperseded).toBe(1);

    // --- final state ---------------------------------------------------------------------
    const after = await snapshot(w.projectX.id);

    // The parcel is the same row, with the same business code. Nothing that points at it moved.
    const parcelRows = await db.migrator.execute(sql`
      select id, parcel_code from app.parcel where id = ${parcelId}
    `);
    expect(parcelRows.rows).toHaveLength(1);
    expect((parcelRows.rows[0] as { parcel_code: string }).parcel_code).toBe("PRED-REP-001");

    const parcelsVersions = after.versions.filter((v) => v.kind === "parcels");
    expect(parcelsVersions.map((v) => [v.version_label, v.is_active])).toEqual([
      ["parcels_v1", false],
      ["parcels_v2_official", true],
    ]);
    // v1 is retained, not deleted: a figure produced from it stays explainable.
    expect(parcelsVersions.find((v) => v.version_label === "parcels_v1")).toBeDefined();
    expect(
      parcelsVersions.find((v) => v.version_label === "parcels_v2_official")?.supersedes_version_id,
    ).toBe(v1.id);

    // Both geometries are retained; exactly one is active, and it is v2's.
    expect(after.geometries).toHaveLength(2);
    expect(after.geometries.filter((g) => g.is_active)).toHaveLength(1);
    expect(after.geometries.find((g) => g.is_active)?.id).toBe(geometryV2);
    for (const geometry of after.geometries) expect(geometry.parcel_id).toBe(parcelId);

    // The alignment was never disturbed: uniqueness is per dataset kind.
    const alignments = after.versions.filter((v) => v.kind === "alignment");
    expect(alignments).toHaveLength(1);
    expect(alignments[0]?.id).toBe(alignmentV1.id);
    expect(alignments[0]?.is_active).toBe(true);

    // And the surface now answers with v2's geometry, from the same parcel row.
    const view = await loadParcelExplorer(db.runtime, await contextFor(w.memberA));
    expect(view.parcels).toHaveLength(1);
    expect(view.parcels[0]?.id).toBe(parcelId);
    expect(view.parcels[0]?.parcelCode).toBe("PRED-REP-001");
    expect(view.layers.find((l) => l.datasetKind === "parcels")?.versionLabel).toBe(
      "parcels_v2_official",
    );
  });

  it("never leaves two active geometries for one parcel", async () => {
    const rows = await db.migrator.execute(sql`
      select parcel_id, count(*)::int as active
      from app.parcel_geometry where is_active
      group by parcel_id having count(*) > 1
    `);
    expect(rows.rows).toEqual([]);
  });

  it("rolls back whole when activation fails, leaving the previous version active", async () => {
    const before = await snapshot(w.projectX.id);
    const activeBefore = before.versions.find((v) => v.kind === "parcels" && v.is_active);
    expect(activeBefore?.version_label).toBe("parcels_v2_official");

    // A third version that does NOT name the version it supersedes. The domain rule rejects it
    // after the read but before any write, and the transaction takes the whole attempt with it.
    const v3 = await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId,
      versionLabel: "parcels_v3_untraceable",
      origin: "imported",
      generatorVersion: null,
      isActive: false,
      supersedesVersionId: null,
      datasetId: parcelsDatasetId,
    });

    const ctx = await contextFor(gisSpecialist);
    await expect(activateDatasetVersion(db.runtime, ctx, v3.id)).rejects.toThrow(/supersede/);

    const after = await snapshot(w.projectX.id);
    // Nothing moved: same active version, same active geometry, same counts.
    expect(
      after.versions.filter((v) => v.kind === "parcels" && v.is_active).map((v) => v.id),
    ).toEqual([activeBefore!.id]);
    expect(after.geometries.filter((g) => g.is_active)).toHaveLength(
      before.geometries.filter((g) => g.is_active).length,
    );
  });

  it("requires geometry.import, not merely the ability to read parcels", async () => {
    // memberA is a VIEWER on project X: it may read every parcel and change none of them. The
    // denial happens before the version id is even looked up, so a probe learns nothing.
    const ctx = await contextFor(w.memberA);
    expect(ctx.projectRole).toBe("VIEWER");
    await expect(activateDatasetVersion(db.runtime, ctx, randomUUID())).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });
});

describe("affectation invariants (IG2-004)", () => {
  let parcelId: string;
  let versionId: string;
  let parcelArea: number;

  beforeAll(async () => {
    const v = await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
      provenanceId: (
        await createProvenanceRecord(db.migrator, {
          tenantId: w.tenantA.id,
          projectId: w.projectY.id,
        })
      ).id,
      kind: "affectations",
      isActive: true,
    });
    versionId = v.id;
    const created = await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
      provenanceId,
      datasetVersionId: versionId,
      parcelCode: "PRED-AFF-001",
    });
    parcelId = created.parcelId;
    const rows = await db.migrator.execute(sql`
      select area_m2::float8 as area from app.parcel_geometry where parcel_id = ${parcelId}
    `);
    parcelArea = (rows.rows[0] as { area: number }).area;
  });

  const insertAffectation = (areaM2: number, category = "right_of_way") =>
    db.migrator.execute(sql`
      insert into app.affectation
        (id, tenant_id, project_id, parcel_id, dataset_version_id, category, geom,
         affected_area_m2, provenance_id)
      values (${randomUUID()}, ${w.tenantA.id}, ${w.projectY.id}, ${parcelId}, ${versionId},
              ${sql.raw(`'${category}'`)},
              ST_GeomFromText(${squareAround(-78.93, -4.07, 0.0005)}, 4326),
              ${areaM2}, ${provenanceId})
    `);

  it("accepts a zero-area affectation: 'not affected' is an observation", async () => {
    await expect(insertAffectation(0, "access")).resolves.toBeDefined();
  });

  it("accepts a partial affectation", async () => {
    await expect(insertAffectation(parcelArea * 0.25, "crops")).resolves.toBeDefined();
  });

  it("accepts a total affectation", async () => {
    await expect(insertAffectation(parcelArea, "infrastructure")).resolves.toBeDefined();
  });

  it("refuses a negative affected area", async () => {
    expect(await attempt(insertAffectation(-1, "other"))).toMatch(/affectation_area_non_negative/);
  });

  it("refuses an affectation larger than its parcel", async () => {
    expect(await attempt(insertAffectation(parcelArea * 1.01, "other"))).toMatch(
      /affectation_exceeds_parcel/,
    );
  });

  it("refuses a parcel geometry with zero or negative area", async () => {
    for (const area of [0, -1]) {
      const error = await attempt(
        db.migrator.execute(sql`
          insert into app.parcel_geometry
            (id, tenant_id, project_id, parcel_id, dataset_version_id, geom, area_m2, is_active,
             provenance_id)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectY.id}, ${parcelId}, ${versionId},
                  ST_GeomFromText(${squareAround(-78.93, -4.07)}, 4326), ${area}, false,
                  ${provenanceId})
        `),
      );
      expect(error, `area ${area}`).toMatch(/parcel_geometry_area_positive/);
    }
  });

  it("does not store the affected share anywhere: it is derived from the two areas", async () => {
    const columns = await db.migrator.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'app' and table_name = 'affectation'
    `);
    const names = (columns.rows as unknown as ReadonlyArray<{ column_name: string }>).map(
      (c) => c.column_name,
    );
    for (const forbidden of ["pct", "percentage", "affected_percentage", "ratio"]) {
      expect(names, `affectation.${forbidden} must not exist`).not.toContain(forbidden);
    }
    // The units are explicit in the name, because "area" alone is a bug waiting to happen.
    expect(names).toContain("affected_area_m2");
  });
});
