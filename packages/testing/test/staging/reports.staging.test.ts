import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getStagingDatabase, rollbackProbe } from "../../src/staging-fixture";
import { loadStagingFixture, type StagingFixtureIds } from "./fixture";

/**
 * The report layer on the persistent environment (Slice 7).
 *
 * Non-destructive throughout. Staging holds no generated chapter — a version is something a
 * specialist produces, not something a fixture seeds — so what is verified here is the shape the
 * environment must have before anyone produces one: the tables, their policies, and the two
 * guarantees that a chapter rests on and that only the database can make.
 *
 * The grant assertion is the one worth writing twice. Migration 0002's `ALTER DEFAULT PRIVILEGES`
 * hands every new `app` table full DML, so an append-only table that merely *adds* a GRANT is
 * silently mutable; only the REVOKE makes it true. That defect was found on `specialist_review`
 * in Slice 5, and a suite that never asked the persistent environment would not have seen it.
 */
const db = getStagingDatabase();
let f: StagingFixtureIds;

const REPORT_TABLES = [
  "generated_report",
  "report_section",
  "report_section_source",
  "report_version",
] as const;

const APPEND_ONLY = ["report_version", "report_section", "report_section_source"] as const;

beforeAll(async () => {
  f = await loadStagingFixture(db.migrator);
});
afterAll(() => db.close());

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const result = await db.migrator.execute(query);
  return (result.rows[0] as { n: number }).n;
}

describe("staging · report tables and their guarantees", () => {
  it("every table exists with RLS enabled, forced and policied", async () => {
    const result = await db.migrator.execute(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relkind = 'r'
         and c.relname in (${sql.join(
           REPORT_TABLES.map((name) => sql`${name}`),
           sql`, `,
         )})
       order by 1
    `);
    const rows = result.rows as Array<{
      table: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
    }>;
    expect(rows.map((r) => r.table)).toEqual([...REPORT_TABLES]);
    for (const row of rows) {
      expect(row.enabled, row.table).toBe(true);
      expect(row.forced, row.table).toBe(true);
      expect(row.policies, row.table).toBeGreaterThanOrEqual(2);
    }
  });

  it("a version, its sections and its sources cannot be updated or deleted by the runtime role", async () => {
    for (const table of APPEND_ONLY) {
      const result = await db.migrator.execute(sql`
        select
          has_table_privilege('eia_app', ${`app.${table}`}, 'SELECT') as can_select,
          has_table_privilege('eia_app', ${`app.${table}`}, 'INSERT') as can_insert,
          has_table_privilege('eia_app', ${`app.${table}`}, 'UPDATE') as can_update,
          has_table_privilege('eia_app', ${`app.${table}`}, 'DELETE') as can_delete
      `);
      expect(result.rows[0], table).toEqual({
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
      });
    }
  });

  it("the immutability triggers are installed and owned by the policy role", async () => {
    const triggers = await db.migrator.execute(sql`
      select t.tgname as name from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and not t.tgisinternal and t.tgname like 'report_%'
       order by 1
    `);
    expect((triggers.rows as Array<{ name: string }>).map((r) => r.name)).toEqual([
      "report_section_no_delete",
      "report_section_no_update",
      "report_section_source_no_delete",
      "report_section_source_no_update",
      "report_version_no_delete",
      "report_version_no_update",
    ]);
    const owner = await db.migrator.execute(sql`
      select pg_get_userbyid(p.proowner) as owner from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'report_version_immutable'
    `);
    expect((owner.rows[0] as { owner: string }).owner).toBe("eia_policy");
  });

  it("a project can hold one chapter of each kind, and a label is unique within it", async () => {
    const indexes = await db.migrator.execute(sql`
      select indexname from pg_indexes
       where schemaname = 'app' and tablename in ('generated_report', 'report_version')
         and indexdef like '%UNIQUE%'
       order by 1
    `);
    const names = (indexes.rows as Array<{ indexname: string }>).map((r) => r.indexname);
    expect(names.some((n) => n.includes("kind"))).toBe(true);
    expect(names.some((n) => n.includes("version_label"))).toBe(true);
  });
});

describe("staging · nobody has generated a chapter, and that is the expected state", () => {
  it("the environment holds no report version: a chapter is produced, never seeded", async () => {
    // If this ever fails it is information, not a defect — someone generated one through the
    // surface. The assertion exists so that a *fixture* quietly acquiring one would be noticed.
    expect(
      await count(sql`
        select count(*)::int as n from app.report_version
         where tenant_id = ${f.tenantId} and project_id = ${f.projectId}
      `),
    ).toBe(0);
  });

  it("the inputs a chapter would read are present", async () => {
    // A generated version is only as honest as what it reads. These are the four sources the
    // snapshot draws on, and their presence is what makes the surface demonstrable on staging.
    expect(
      await count(sql`
        select count(*)::int as n from app.survey_instance
         where tenant_id = ${f.tenantId} and project_id = ${f.projectId} and status = 'SUBMITTED'
      `),
    ).toBeGreaterThan(0);
    expect(
      await count(sql`
        select count(*)::int as n from app.document_version
         where tenant_id = ${f.tenantId} and project_id = ${f.projectId}
      `),
    ).toBeGreaterThan(0);
    expect(
      await count(sql`
        select count(*)::int as n from app.taxonomy_version
         where tenant_id = ${f.tenantId} and project_id = ${f.projectId} and status = 'PUBLISHED'
      `),
    ).toBeGreaterThan(0);
  });
});

describe("staging · the guarantees, probed inside a transaction that always rolls back", () => {
  /**
   * A chapter exists here only for the length of this transaction. It is created by the owning
   * role, amended, and rolled back — so the environment is byte-identical afterwards and the
   * trigger is asserted against a real row rather than against a statement that matches none.
   */
  async function withVersion(
    amend: (ids: { report: string; version: string }) => ReturnType<typeof sql>,
  ) {
    return rollbackProbe(db.migrator, async (tx) => {
      const provenance = crypto.randomUUID();
      const report = crypto.randomUUID();
      const version = crypto.randomUUID();
      await tx.execute(sql`
        insert into app.provenance_record
          (id, tenant_id, project_id, regime, origin, transformations, granularity, title, note,
           method, validation_state, captured_at)
        values (${provenance}, ${f.tenantId}, ${f.projectId}, 'DEMO_SIMULATION', 'SYSTEM_GENERATED',
                ARRAY['DERIVED']::app.provenance_transformation[], 'AGGREGATE',
                'Sonda de verificación', 'Transacción revertida.', 'Sonda.', 'PENDING', now())
      `);
      await tx.execute(sql`
        insert into app.generated_report (id, tenant_id, project_id, kind, title)
        values (${report}, ${f.tenantId}, ${f.projectId}, 'social_chapter', 'Sonda')
      `);
      await tx.execute(sql`
        insert into app.report_version
          (id, tenant_id, project_id, report_id, version_label, snapshot, snapshot_digest,
           survey_version_label, generated_by_user_id, provenance_id)
        values (${version}, ${f.tenantId}, ${f.projectId}, ${report}, 'v-probe',
                ${JSON.stringify({ kind: "probe" })}::jsonb, 'probe', 'v1',
                ${f.coordinatorUserId}, ${provenance})
      `);
      await tx.execute(amend({ report, version }));
    });
  }

  it("refuses to amend a stored version, even for the owning role", async () => {
    const probe = await withVersion(
      ({ version }) =>
        sql`update app.report_version set version_label = 'v0' where id = ${version}`,
    );
    expect(probe.error).toMatch(/report_version_immutable/);
  });

  it("refuses to delete one, so a chapter cannot quietly stop having been produced", async () => {
    const probe = await withVersion(
      ({ version }) => sql`delete from app.report_version where id = ${version}`,
    );
    expect(probe.error).toMatch(/report_version_immutable/);
  });

  it("but the cascade from its report is allowed, which is the one legitimate route", async () => {
    const probe = await withVersion(
      ({ report }) => sql`delete from app.generated_report where id = ${report}`,
    );
    expect(probe.error).toBeNull();
  });
});
