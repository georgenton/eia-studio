import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getStagingDatabase, rollbackProbe } from "../../src/staging-fixture";
import { loadStagingFixture, type StagingFixtureIds } from "./fixture";

/**
 * The Quality Gate on the persistent environment (Slice 5).
 *
 * Non-destructive throughout, like the rest of this suite: catalogue reads, fixture reads, and
 * rollback probes for the contracts that can only be observed by attempting what they forbid.
 *
 * The probes matter more here than anywhere else so far. The module's whole promise is that a
 * specialist's decision is permanent and that a finding always shows two sides; both are database
 * guarantees, and a guarantee that holds on a Testcontainer and not on staging is not one.
 */
const db = getStagingDatabase();
let f: StagingFixtureIds;

const QUALITY_TABLES = [
  "document_assertion",
  "finding_evidence",
  "quality_finding",
  "quality_run",
  "specialist_review",
] as const;

beforeAll(async () => {
  f = await loadStagingFixture(db.migrator);
});
afterAll(() => db.close());

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const result = await db.migrator.execute(query);
  return (result.rows[0] as { n: number }).n;
}

describe("staging · Quality Gate tables and their guarantees", () => {
  it("every table exists with RLS enabled, forced and policied", async () => {
    const result = await db.migrator.execute(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relkind = 'r'
         and c.relname in (${sql.join(
           QUALITY_TABLES.map((name) => sql`${name}`),
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
    expect(rows.map((r) => r.table)).toEqual([...QUALITY_TABLES]);
    for (const row of rows) {
      expect(row.enabled, row.table).toBe(true);
      expect(row.forced, row.table).toBe(true);
      expect(row.policies, row.table).toBeGreaterThanOrEqual(2);
    }
  });

  it("a specialist decision cannot be updated or deleted by the runtime role", async () => {
    // The grant, not only the trigger: migration 0002 grants UPDATE and DELETE on every new table
    // in `app` by default, so the REVOKE is what actually makes this true.
    const result = await db.migrator.execute(sql`
      select
        has_table_privilege('eia_app', 'app.specialist_review', 'SELECT') as can_select,
        has_table_privilege('eia_app', 'app.specialist_review', 'INSERT') as can_insert,
        has_table_privilege('eia_app', 'app.specialist_review', 'UPDATE') as can_update,
        has_table_privilege('eia_app', 'app.specialist_review', 'DELETE') as can_delete
    `);
    expect(result.rows[0]).toEqual({
      can_select: true,
      can_insert: true,
      can_update: false,
      can_delete: false,
    });
  });

  it("the append-only and two-source triggers are installed", async () => {
    const result = await db.migrator.execute(sql`
      select t.tgname as name
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and not t.tgisinternal
         and t.tgname in ('specialist_review_no_update', 'specialist_review_no_delete',
                          'quality_finding_two_sources', 'finding_evidence_two_sources')
       order by 1
    `);
    expect(result.rows.map((r) => (r as { name: string }).name)).toEqual([
      "finding_evidence_two_sources",
      "quality_finding_two_sources",
      "specialist_review_no_delete",
      "specialist_review_no_update",
    ]);
  });

  it("the trigger functions are owned by the policy role, like every other one", async () => {
    const result = await db.migrator.execute(sql`
      select p.proname as name, pg_get_userbyid(p.proowner) as owner
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app'
         and p.proname in ('specialist_review_append_only', 'quality_finding_has_two_sources')
       order by 1
    `);
    const rows = result.rows as Array<{ name: string; owner: string }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.owner, row.name).toBe("eia_policy");
  });

  it("the value and citation checks are installed", async () => {
    const result = await db.migrator.execute(sql`
      select conname as name from pg_constraint
       where conrelid = 'app.document_assertion'::regclass and contype = 'c'
       order by 1
    `);
    const names = result.rows.map((r) => (r as { name: string }).name);
    expect(names).toContain("document_assertion_single_value");
    expect(names).toContain("document_assertion_date_shape");
    expect(names).toContain("document_assertion_source_kind_available");
  });
});

describe("staging · the reconstructed corpus", () => {
  it("holds the fixture's assertions, all reconstructed and none citing a page", async () => {
    const rows = await db.migrator.execute(sql`
      select key, source_kind::text as source_kind, source_ref
        from app.document_assertion
       where tenant_id = ${f.tenantId} and project_id = ${f.projectId}
       order by key, source_ref
    `);
    const assertions = rows.rows as Array<{ key: string; source_kind: string; source_ref: string }>;
    expect(assertions.length).toBeGreaterThanOrEqual(8);
    for (const assertion of assertions) {
      // Nothing may claim to come from an ingested document while none exists: that would be a
      // fabricated citation in the one field whose purpose is verification (ADR-020 §5).
      expect(assertion.source_kind, assertion.key).toBe("RECONSTRUCTED_CORPUS");
      expect(assertion.source_ref.length).toBeGreaterThan(0);
    }
    expect(assertions.map((a) => a.key)).toContain("parcels.affected_count");
  });

  it("every assertion carries a provenance record of its own project", async () => {
    expect(
      await count(sql`
        select count(*)::int as n
          from app.document_assertion a
          left join app.provenance_record p on p.tenant_id = a.tenant_id and p.id = a.provenance_id
         where p.id is null
      `),
    ).toBe(0);
  });

  it("the assertions' provenance says it is a reconstruction from a document", async () => {
    const rows = await db.migrator.execute(sql`
      select distinct p.regime::text as regime, p.origin::text as origin,
             p.transformations::text as transformations
        from app.document_assertion a
        join app.provenance_record p on p.tenant_id = a.tenant_id and p.id = a.provenance_id
       where a.tenant_id = ${f.tenantId} and a.project_id = ${f.projectId}
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      regime: "HISTORICAL_OBSERVED",
      origin: "IMPORTED_DOCUMENT",
      transformations: "{RECONSTRUCTED}",
    });
  });
});

describe("staging · findings, if any, are the output of a run", () => {
  it("no finding exists without a run and without exactly two sources", async () => {
    expect(
      await count(sql`
        select count(*)::int as n from app.quality_finding f
         where not exists (select 1 from app.quality_run r
                            where r.tenant_id = f.tenant_id and r.id = f.first_run_id)
      `),
    ).toBe(0);
    expect(
      await count(sql`
        select count(*)::int as n from app.quality_finding f
         where (select count(*) from app.finding_evidence e
                 where e.tenant_id = f.tenant_id and e.finding_id = f.id
                   and e.role = 'SOURCE_A') <> 1
            or (select count(*) from app.finding_evidence e
                 where e.tenant_id = f.tenant_id and e.finding_id = f.id
                   and e.role = 'SOURCE_B') <> 1
      `),
    ).toBe(0);
  });

  it("every decision carries a justification and an author", async () => {
    expect(
      await count(sql`
        select count(*)::int as n from app.specialist_review
         where length(btrim(justification)) < 12 or reviewer_user_id is null
      `),
    ).toBe(0);
  });

  it("no finding's copy declares compliance", async () => {
    // Invariant 11, asserted against whatever is actually stored rather than against the templates.
    const rows = await db.migrator.execute(sql`
      select lower(title || ' ' || explanation || ' ' || why_flagged || ' ' || suggested_action)
             as text
        from app.quality_finding
    `);
    for (const row of rows.rows as Array<{ text: string }>) {
      for (const forbidden of ["incumplimiento", "infracción", "error detectado", "no conforme"]) {
        expect(row.text, forbidden).not.toContain(forbidden);
      }
    }
  });
});

describe("staging · the guarantees, probed inside a transaction that always rolls back", () => {
  it("refuses an assertion holding two values", async () => {
    const probe = await rollbackProbe(db.migrator, (tx) =>
      tx.execute(sql`
        insert into app.document_assertion
          (id, tenant_id, project_id, key, source_kind, source_ref, value_number, value_text,
           provenance_id)
        select gen_random_uuid(), ${f.tenantId}, ${f.projectId}, 'probe.two_values',
               'RECONSTRUCTED_CORPUS', 'probe', 1, 'uno', a.provenance_id
          from app.document_assertion a
         where a.tenant_id = ${f.tenantId} and a.project_id = ${f.projectId} limit 1
      `),
    );
    expect(probe.error).toMatch(/document_assertion_single_value/);
  });

  it("refuses an assertion claiming to come from an ingested document", async () => {
    const probe = await rollbackProbe(db.migrator, (tx) =>
      tx.execute(sql`
        insert into app.document_assertion
          (id, tenant_id, project_id, key, source_kind, source_ref, value_number, provenance_id)
        select gen_random_uuid(), ${f.tenantId}, ${f.projectId}, 'probe.fake_citation',
               'DOCUMENT_VERSION', 'probe', 1, a.provenance_id
          from app.document_assertion a
         where a.tenant_id = ${f.tenantId} and a.project_id = ${f.projectId} limit 1
      `),
    );
    expect(probe.error).toMatch(/document_assertion_source_kind_available/);
  });
});
