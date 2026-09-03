import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getStagingDatabase, rollbackProbe } from "../../src/staging-fixture";
import { loadStagingFixture, type StagingFixtureIds } from "./fixture";

/**
 * The document layer on the persistent environment (Slice 6).
 *
 * Non-destructive throughout. The probes matter because the two guarantees this layer rests on are
 * database guarantees — a chunk never changes, and a query cannot leave its project — and a
 * guarantee that holds on a Testcontainer and not on staging is not one.
 */
const db = getStagingDatabase();
let f: StagingFixtureIds;

const DOCUMENT_TABLES = ["document_chunk", "document_version", "source_document"] as const;

beforeAll(async () => {
  f = await loadStagingFixture(db.migrator);
});
afterAll(() => db.close());

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const result = await db.migrator.execute(query);
  return (result.rows[0] as { n: number }).n;
}

describe("staging · document tables and their guarantees", () => {
  it("every table exists with RLS enabled, forced and policied", async () => {
    const result = await db.migrator.execute(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relkind = 'r'
         and c.relname in (${sql.join(
           DOCUMENT_TABLES.map((name) => sql`${name}`),
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
    expect(rows.map((r) => r.table)).toEqual([...DOCUMENT_TABLES]);
    for (const row of rows) {
      expect(row.enabled, row.table).toBe(true);
      expect(row.forced, row.table).toBe(true);
      expect(row.policies, row.table).toBeGreaterThanOrEqual(2);
    }
  });

  it("a chunk cannot be updated or deleted by the runtime role", async () => {
    const result = await db.migrator.execute(sql`
      select
        has_table_privilege('eia_app', 'app.document_chunk', 'SELECT') as can_select,
        has_table_privilege('eia_app', 'app.document_chunk', 'INSERT') as can_insert,
        has_table_privilege('eia_app', 'app.document_chunk', 'UPDATE') as can_update,
        has_table_privilege('eia_app', 'app.document_chunk', 'DELETE') as can_delete
    `);
    expect(result.rows[0]).toEqual({
      can_select: true,
      can_insert: true,
      can_update: false,
      can_delete: false,
    });
  });

  it("the immutability triggers are installed and owned by the policy role", async () => {
    const triggers = await db.migrator.execute(sql`
      select t.tgname as name from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and not t.tgisinternal
         and t.tgname in ('document_chunk_no_update', 'document_chunk_no_delete')
       order by 1
    `);
    expect(triggers.rows.map((r) => (r as { name: string }).name)).toEqual([
      "document_chunk_no_delete",
      "document_chunk_no_update",
    ]);
    const owner = await db.migrator.execute(sql`
      select pg_get_userbyid(p.proowner) as owner from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'document_chunk_immutable'
    `);
    expect((owner.rows[0] as { owner: string }).owner).toBe("eia_policy");
  });

  it("the search index exists, and no embedding column does (ADR-021)", async () => {
    const columns = await db.migrator.execute(sql`
      select column_name from information_schema.columns
       where table_schema = 'app' and table_name = 'document_chunk'
    `);
    const names = (columns.rows as Array<{ column_name: string }>).map((r) => r.column_name);
    expect(names).toContain("search");
    // A vector filled by a stand-in is indistinguishable from a real one; there is none here, and
    // this assertion is what makes adding one a deliberate act.
    expect(names).not.toContain("embedding");
    expect(
      await count(sql`select count(*)::int as n from pg_namespace where nspname = 'vec'`),
    ).toBe(0);
    expect(
      await count(sql`
        select count(*)::int as n from pg_indexes
         where schemaname = 'app' and indexname = 'document_chunk_search_idx'
      `),
    ).toBe(1);
  });
});

describe("staging · the ingested corpus", () => {
  it("holds the fixture's excerpts, every one labelled a reconstruction", async () => {
    const rows = await db.migrator.execute(sql`
      select d.code, v.version_label, v.text_source::text as text_source, v.chunk_count,
             v.chunking_strategy, v.imported_by_user_id
        from app.source_document d
        join app.document_version v on v.tenant_id = d.tenant_id and v.id = d.current_version_id
       where d.tenant_id = ${f.tenantId} and d.project_id = ${f.projectId}
       order by d.code
    `);
    const versions = rows.rows as Array<{
      code: string;
      text_source: string;
      chunk_count: number;
      chunking_strategy: string;
      imported_by_user_id: string | null;
    }>;
    expect(versions.length).toBeGreaterThanOrEqual(6);
    for (const version of versions) {
      expect(version.text_source, version.code).toBe("RECONSTRUCTED_EXCERPT");
      expect(version.chunk_count, version.code).toBeGreaterThan(0);
      expect(version.chunking_strategy, version.code).toMatch(/@\d+$/);
      // Nobody imported these: the fixture did, and attributing them to a demo identity would put
      // a name on an action that person did not take.
      expect(version.imported_by_user_id, version.code).toBeNull();
    }
  });

  it("every chunk belongs to a version of its own project, and none is orphaned", async () => {
    expect(
      await count(sql`
        select count(*)::int as n from app.document_chunk c
          left join app.document_version v on v.tenant_id = c.tenant_id and v.id = c.version_id
         where v.id is null or v.project_id <> c.project_id
      `),
    ).toBe(0);
  });

  it("full-text retrieval finds the corpus, scoped to one project", async () => {
    const found = await count(sql`
      with q as (select websearch_to_tsquery('spanish', 'predios afectados') as tsq)
      select count(*)::int as n
        from app.document_chunk c join q on true
       where c.tenant_id = ${f.tenantId} and c.project_id = ${f.projectId} and c.search @@ q.tsq
    `);
    expect(found).toBeGreaterThan(0);
    // …and the same query outside this project's scope finds none of it.
    expect(
      await count(sql`
        with q as (select websearch_to_tsquery('spanish', 'predios afectados') as tsq)
        select count(*)::int as n
          from app.document_chunk c join q on true
         where c.project_id <> ${f.projectId} and c.search @@ q.tsq
      `),
    ).toBe(0);
  });

  it("the Quality Gate's assertions now point at the passage they were transcribed from", async () => {
    // The Slice 5 → Slice 6 enrichment (ADR-020 §6). The assertions stay reconstructed; they gain a
    // reference, and findings raised before ingestion were never rewritten.
    const linked = await count(sql`
      select count(*)::int as n from app.document_assertion
       where tenant_id = ${f.tenantId} and project_id = ${f.projectId}
         and document_version_id is not null
    `);
    expect(linked).toBeGreaterThanOrEqual(8);
    expect(
      await count(sql`
        select count(*)::int as n from app.document_assertion
         where tenant_id = ${f.tenantId} and source_kind <> 'RECONSTRUCTED_CORPUS'
      `),
    ).toBe(0);
  });
});

describe("staging · the guarantees, probed inside a transaction that always rolls back", () => {
  it("refuses to change a passage a citation may point at", async () => {
    const probe = await rollbackProbe(db.migrator, (tx) =>
      tx.execute(sql`
        update app.document_chunk set text = 'reescrito'
         where tenant_id = ${f.tenantId} and project_id = ${f.projectId}
      `),
    );
    expect(probe.error).toMatch(/document_chunk_immutable/);
  });

  it("refuses to delete one out from under a citation", async () => {
    const probe = await rollbackProbe(db.migrator, (tx) =>
      tx.execute(sql`
        delete from app.document_chunk
         where tenant_id = ${f.tenantId} and project_id = ${f.projectId}
      `),
    );
    expect(probe.error).toMatch(/document_chunk_immutable/);
  });
});
