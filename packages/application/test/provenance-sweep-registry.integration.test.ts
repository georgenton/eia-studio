import {
  createInfluenceArea,
  createProvenanceRecord,
  createSpatialDatasetVersion,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PROVENANCE_BEARING_TABLES, orphanProvenanceSweep } from "../src/projects/provenance-sweep";

/**
 * The demo seeder's orphan-provenance sweep, as a **registry** (TD-125).
 *
 * The sweep deletes a project's provenance records that nothing references any more, and decides
 * "nothing" from an enumeration of provenance-bearing tables. That enumeration was written by hand
 * and fell eleven tables behind the schema. The consequence: a local database that had ever run
 * `e2e/document-review.spec.ts` could not be re-seeded at all — the delete hit
 * `report_template_version_provenance_fk`, and the blocking review rows could not be removed either
 * because a candidate is append-only by trigger (ADR-035). The only way out was
 * `pnpm db:reset:local`.
 *
 * CI never saw it, because its database is new every run — which is also why a fixture-shaped test
 * would not have caught it. So the first test here is written against `pg_catalog`, in the shape of
 * the project-scoping registry in `packages/testing/test/rls/wave3-two-projects.integration.test.ts`:
 * it fails when the *migration* lands, not when somebody happens to re-seed the right database.
 *
 * The catalogue is read as **foreign keys** rather than as columns named `provenance_id`. What blocks
 * the delete is a constraint, not a name — and the two already differ: `provenance_input` references
 * `provenance_record` twice, the second time through `input_provenance_id`.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
});
afterAll(() => db.close());

interface ReferencingRow {
  readonly table: string;
}

/** Every table in `app` with a foreign key to `app.provenance_record`. */
async function provenanceReferencingTables(): Promise<ReadonlyArray<string>> {
  const result = await db.migrator.execute(sql`
    select distinct child.relname as table
      from pg_constraint con
      join pg_class child on child.oid = con.conrelid
      join pg_namespace ns on ns.oid = child.relnamespace
      join pg_class parent on parent.oid = con.confrelid
     where con.contype = 'f'
       and ns.nspname = 'app'
       and parent.relname = 'provenance_record'
     order by 1
  `);
  return (result.rows as unknown as ReferencingRow[]).map((row) => row.table);
}

describe("the demo seeder's provenance sweep registry", () => {
  it("accounts for every table that can reference a provenance record", async () => {
    const inCatalogue = await provenanceReferencingTables();
    expect(inCatalogue.length).toBeGreaterThan(20);

    const accountedFor = PROVENANCE_BEARING_TABLES.map((entry) => entry.table);

    // Named rather than counted: "31 ≠ 20" sends the next person back to the catalogue to work out
    // which eleven, and the remedy differs per table — one the seeder clears before the sweep goes
    // in CLEARED_BEFORE_SWEEP_TABLES, anything else in SWEEP_PROTECTED_TABLES.
    expect(
      {
        forgotten: inCatalogue.filter((table) => !accountedFor.includes(table)),
        stale: accountedFor.filter((table) => !inCatalogue.includes(table)),
      },
      "packages/application/src/projects/provenance-sweep.ts disagrees with the schema",
    ).toEqual({ forgotten: [], stale: [] });
  });

  it("removes an unreferenced record and keeps one an influence area still points at", async () => {
    // `influence_area` is one of the eleven the hand-written chain forgot, and the seeder rebuilds
    // its rows *after* the sweep against the same derived record — so a sweep that deleted the
    // record would fail on the foreign key. The assertion is that it does not.
    const kept = await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      title: "Referenced by an influence area",
    });
    const version = await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      provenanceId: kept.id,
    });
    await createInfluenceArea(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      datasetVersionId: version.id,
      provenanceId: kept.id,
    });
    const orphan = await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      title: "Referenced by nothing",
    });

    await db.migrator.execute(orphanProvenanceSweep(w.projectX.id));

    const survivors = await db.migrator.execute(sql`
      select id from app.provenance_record where id in (${kept.id}, ${orphan.id})
    `);
    expect((survivors.rows as unknown as ReadonlyArray<{ id: string }>).map((r) => r.id)).toEqual([
      kept.id,
    ]);
  });

  it("leaves another project's records alone", async () => {
    const elsewhere = await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectY.id,
      title: "Another project's orphan",
    });

    await db.migrator.execute(orphanProvenanceSweep(w.projectX.id));

    const still = await db.migrator.execute(
      sql`select count(*)::int as n from app.provenance_record where id = ${elsewhere.id}`,
    );
    expect((still.rows[0] as { n: number }).n).toBe(1);
  });
});
