import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asContext,
  attempt,
  countVisible,
  createProvenanceRecord,
  getTestDatabase,
  resetDatabase,
  RLS_VIOLATION,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * Isolation of the influence areas, and the multi-part geometry the real package forced (ADR-023).
 *
 * An area of influence is the least sensitive layer in the product — it names no person and holds
 * no code — which is exactly why it is worth testing: a table added late, for a layer nobody
 * thinks of as confidential, is where a missing policy would survive review. It gets the same
 * three-part predicate as every other project-scoped table.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let provA: string;
let provB: string;
let versionA: string;
let versionB: string;

const ctxA = (projectId: string | null = null) => ({
  userId: w.memberA.id,
  tenantId: w.tenantA.id,
  projectId: projectId ?? w.projectX.id,
});

/** A square kilometre or so, near the real corridor. Two disjoint parts, because that is the case. */
const TWO_PART =
  "MULTIPOLYGON(((-78.74 -3.80,-78.73 -3.80,-78.73 -3.79,-78.74 -3.79,-78.74 -3.80))," +
  "((-78.72 -3.78,-78.71 -3.78,-78.71 -3.77,-78.72 -3.77,-78.72 -3.78)))";

async function makeVersion(tenantId: string, projectId: string, provenanceId: string) {
  const datasetId = randomUUID();
  const versionId = randomUUID();
  await db.migrator.execute(sql`
    insert into app.spatial_dataset (id, tenant_id, project_id, kind, label)
    values (${datasetId}, ${tenantId}, ${projectId}, 'influence_areas', 'Áreas de influencia')
  `);
  await db.migrator.execute(sql`
    insert into app.spatial_dataset_version
      (id, tenant_id, project_id, dataset_id, version_label, origin, source_srid, analysis_srid,
       feature_count, is_active, produced_at, provenance_id)
    values (${versionId}, ${tenantId}, ${projectId}, ${datasetId}, 'influence_areas_v1',
            'imported', 32717, 32717, 1, true, now(), ${provenanceId})
  `);
  return versionId;
}

async function insertArea(
  tenantId: string,
  projectId: string,
  versionId: string,
  provenanceId: string,
  kind = "direct",
) {
  const id = randomUUID();
  await db.migrator.execute(sql`
    insert into app.influence_area
      (id, tenant_id, project_id, dataset_version_id, kind, label, geom, area_m2, provenance_id)
    values (${id}, ${tenantId}, ${projectId}, ${versionId}, ${sql.raw(`'${kind}'`)},
            'Área de influencia directa',
            ST_Multi(ST_GeomFromText(${TWO_PART}, 4326)),
            ST_Area(ST_Transform(ST_GeomFromText(${TWO_PART}, 4326), 32717)),
            ${provenanceId})
  `);
  return id;
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  provA = (
    await createProvenanceRecord(db.migrator, { tenantId: w.tenantA.id, projectId: w.projectX.id })
  ).id;
  provB = (
    await createProvenanceRecord(db.migrator, { tenantId: w.tenantB.id, projectId: w.projectZ.id })
  ).id;
  versionA = await makeVersion(w.tenantA.id, w.projectX.id, provA);
  versionB = await makeVersion(w.tenantB.id, w.projectZ.id, provB);
  await insertArea(w.tenantA.id, w.projectX.id, versionA, provA);
  await insertArea(w.tenantB.id, w.projectZ.id, versionB, provB);
});

afterAll(() => db.close());

describe("influence areas are isolated like every other project-scoped table", () => {
  it("a member of tenant A sees A's areas and none of B's", async () => {
    expect(await countVisible(db.runtime, ctxA(), "app.influence_area")).toBe(1);

    const asB = { userId: w.memberA.id, tenantId: w.tenantB.id, projectId: w.projectZ.id };
    expect(await countVisible(db.runtime, asB, "app.influence_area")).toBe(0);
  });

  it("a forged tenant_id is refused on write, not merely hidden on read", async () => {
    const probe = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
        insert into app.influence_area
          (id, tenant_id, project_id, dataset_version_id, kind, label, geom, area_m2, provenance_id)
        values (${randomUUID()}, ${w.tenantB.id}, ${w.projectZ.id}, ${versionB}, 'direct',
                'Robada', ST_Multi(ST_GeomFromText(${TWO_PART}, 4326)), 1, ${provB})
        `),
      ),
    );
    expect(probe).toMatch(RLS_VIOLATION);
  });

  it("no context at all sees nothing", async () => {
    const none = { userId: null, tenantId: null, projectId: null };
    expect(await countVisible(db.runtime, none, "app.influence_area")).toBe(0);
  });

  it("row level security is enabled and FORCEd", async () => {
    const result = await db.migrator.execute(sql`
      select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'influence_area'
    `);
    expect(result.rows[0]).toEqual({ enabled: true, forced: true, policies: 2 });
  });
});

describe("the geometry the real package required", () => {
  it("stores a two-part area as two parts, and measures both", async () => {
    const result = await db.migrator.execute(sql`
      select ST_GeometryType(geom) as type, ST_NumGeometries(geom)::int as parts,
             round(area_m2)::int as area
        from app.influence_area where tenant_id = ${w.tenantA.id}
    `);
    const row = result.rows[0] as { type: string; parts: number; area: number };
    expect(row.type).toBe("ST_MultiPolygon");
    // The part that would be lost by flattening to the largest polygon is real land.
    expect(row.parts).toBe(2);
    expect(row.area).toBeGreaterThan(1_000_000);
  });

  it("a parcel boundary is multi-part too, so a plot split by the road survives storage", async () => {
    const columns = await db.migrator.execute(sql`
      select f_table_name as table, type from geometry_columns
       where f_table_schema = 'app'
         and f_table_name in ('parcel_geometry', 'affectation', 'alignment', 'influence_area')
       order by 1
    `);
    expect(columns.rows).toEqual([
      { table: "affectation", type: "MULTIPOLYGON" },
      { table: "alignment", type: "MULTILINESTRING" },
      { table: "influence_area", type: "MULTIPOLYGON" },
      { table: "parcel_geometry", type: "MULTIPOLYGON" },
    ]);
  });

  it("one kind of area exists once per version, so a redelimitation is a new version", async () => {
    const probe = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          insert into app.influence_area
            (id, tenant_id, project_id, dataset_version_id, kind, label, geom, area_m2, provenance_id)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${versionA}, 'direct',
                  'Segunda AID de la misma versión',
                  ST_Multi(ST_GeomFromText(${TWO_PART}, 4326)), 1, ${provA})
        `),
      ),
    );
    expect(probe).toMatch(/influence_area_version_kind_key/);
  });
});

describe("a parcel's chainage can be a range", () => {
  it("stores a start and an end, and accepts the reversed pair the package actually contains", async () => {
    // `080A` runs 2 583 → 2 557 in the delivered data. The database stores what the source said;
    // saying the two disagree is the Quality Gate's job, not a write error (ADR-023).
    const parcelId = randomUUID();
    await db.migrator.execute(sql`
      insert into app.parcel
        (id, tenant_id, project_id, parcel_code, side, status,
         chainage_m, chainage_start_m, chainage_end_m, chainage_method, provenance_id)
      values (${parcelId}, ${w.tenantA.id}, ${w.projectX.id}, '080A', 'left', 'confirmed',
              2583, 2583, 2557, 'declared', ${provA})
    `);
    const row = await db.migrator.execute(sql`
      select chainage_start_m::float8 as start, chainage_end_m::float8 as finish,
             chainage_method::text as method
        from app.parcel where id = ${parcelId}
    `);
    expect(row.rows[0]).toEqual({ start: 2583, finish: 2557, method: "declared" });
  });

  it("still refuses a negative abscissa, which is nonsense rather than a disagreement", async () => {
    const probe = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          insert into app.parcel
            (id, tenant_id, project_id, parcel_code, side, status, chainage_m, chainage_method,
             provenance_id)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, '999', 'left', 'confirmed',
                  -10, 'declared', ${provA})
        `),
      ),
    );
    expect(probe).toMatch(/parcel_chainage_non_negative/);
  });

  it("accepts the package's own code shapes, including the two spellings of one parcel", async () => {
    for (const code of ["001", "032A", "042a"]) {
      const probe = await attempt(
        asContext(db.runtime, ctxA(), (tx) =>
          tx.execute(sql`
            insert into app.parcel
              (id, tenant_id, project_id, parcel_code, side, status, provenance_id)
            values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${code}, 'left',
                    'confirmed', ${provA})
          `),
        ),
      );
      expect(probe, code).toBeNull();
    }
  });

  it("but still refuses something that is plainly not a code", async () => {
    const probe = await attempt(
      asContext(db.runtime, ctxA(), (tx) =>
        tx.execute(sql`
          insert into app.parcel
            (id, tenant_id, project_id, parcel_code, side, status, provenance_id)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id},
                  'Predio de María González, escritura 4471', 'left', 'confirmed', ${provA})
        `),
      ),
    );
    expect(probe).toMatch(/parcel_code_shape/);
  });
});
