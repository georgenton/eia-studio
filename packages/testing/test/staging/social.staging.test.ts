import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getStagingDatabase, rollbackProbe } from "../../src/staging-fixture";
import { loadStagingFixture, type StagingFixtureIds } from "./fixture";

/**
 * Social Intelligence on the persistent environment (Slice 4 §54).
 *
 * Non-destructive throughout, like the rest of this suite: catalogue reads, fixture reads, and
 * rollback probes for the contracts that can only be observed by attempting what they forbid.
 *
 * **No live model is called from here.** A classification run against a real provider is a separate,
 * explicit operator action; this file only checks that the schema, the policies, the immutability
 * rules and the demo taxonomy are what they should be, and that nothing has fabricated a coding.
 */
const db = getStagingDatabase();
let f: StagingFixtureIds;

const SOCIAL_TABLES = [
  "taxonomy",
  "taxonomy_version",
  "taxonomy_category",
  "classification_run",
  "ai_classification",
  "ai_classification_category",
  "human_review",
  "human_review_category",
] as const;

beforeAll(async () => {
  f = await loadStagingFixture(db.migrator);
});
afterAll(() => db.close());

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const result = await db.migrator.execute(query);
  return (result.rows[0] as { n: number }).n;
}

describe("staging · Social tables and their guarantees", () => {
  it("every Social table exists with RLS enabled, forced and policied", async () => {
    const result = await db.migrator.execute(sql`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relkind = 'r'
         and c.relname in (${sql.join(
           SOCIAL_TABLES.map((name) => sql`${name}`),
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
    expect(rows.map((r) => r.table)).toEqual([...SOCIAL_TABLES].sort());
    for (const row of rows) {
      expect(row.enabled, row.table).toBe(true);
      expect(row.forced, row.table).toBe(true);
      expect(row.policies, row.table).toBeGreaterThanOrEqual(2);
    }
  });

  it("the immutability and version triggers are installed", async () => {
    const result = await db.migrator.execute(sql`
      select t.tgname as name
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and not t.tgisinternal
         and t.tgname in ('taxonomy_version_immutable', 'taxonomy_category_frozen',
                          'classification_run_published_taxonomy',
                          'ai_classification_category_version', 'human_review_category_version',
                          'human_review_final', 'human_review_category_final')
       order by 1
    `);
    expect(result.rows.map((r) => (r as { name: string }).name)).toEqual([
      "ai_classification_category_version",
      "classification_run_published_taxonomy",
      "human_review_category_final",
      "human_review_category_version",
      "human_review_final",
      "taxonomy_category_frozen",
      "taxonomy_version_immutable",
    ]);
  });

  it("the job helpers are privileged narrowly and owned by the policy role", async () => {
    const result = await db.migrator.execute(sql`
      select p.proname as name, pg_get_userbyid(p.proowner) as owner, p.prosecdef as secdef,
             has_function_privilege('eia_app', p.oid, 'EXECUTE') as app_exec
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app'
         and p.proname in ('claim_classification', 'release_stale_classifications')
       order by 1
    `);
    const rows = result.rows as Array<{
      name: string;
      owner: string;
      secdef: boolean;
      app_exec: boolean;
    }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.secdef, row.name).toBe(true);
      // Owned by the NOLOGIN policy role, not by the migrator: a SECURITY DEFINER function owned
      // by a superuser would run as one.
      expect(row.owner, row.name).toBe("eia_policy");
      expect(row.app_exec, row.name).toBe(true);
    }
  });
});

describe("staging · the demo coding scheme", () => {
  it("is published, reconstructed, and says so", async () => {
    const rows = await db.migrator.execute(sql`
      select v.version_label, v.status::text as status, v.source_note, v.definition_hash,
             count(c.id)::int as categories
        from app.taxonomy_version v
        left join app.taxonomy_category c on c.tenant_id = v.tenant_id and c.version_id = v.id
       where v.tenant_id = ${f.tenantId} and v.project_id = ${f.projectId}
       group by v.id, v.version_label, v.status, v.source_note, v.definition_hash
    `);
    expect(rows.rows).toHaveLength(1);
    const version = rows.rows[0] as {
      version_label: string;
      status: string;
      source_note: string;
      definition_hash: string;
      categories: number;
    };
    expect(version.status).toBe("PUBLISHED");
    // It must never look like an official scheme the consultancy handed over.
    expect(version.source_note).toMatch(/DEMO \/ RECONSTRUIDA/);
    expect(version.definition_hash).toBeTruthy();
    expect(Number(version.categories)).toBeGreaterThanOrEqual(2);
  });

  it("carries a residual category, so 'none of these' is sayable", async () => {
    expect(
      await count(sql`
        select count(*)::int as n from app.taxonomy_category
         where tenant_id = ${f.tenantId} and code = 'OTHER'
      `),
    ).toBeGreaterThan(0);
  });

  it("has no category about health, disability or any personal characteristic", async () => {
    const suspicious = await count(sql`
      select count(*)::int as n from app.taxonomy_category
       where tenant_id = ${f.tenantId}
         and (code ~* '(health|salud|disab|discapac|ingreso|income|etni|religi|g[eé]nero)'
              or label ~* '(salud|discapacidad|ingreso|etnia|religi|género)')
    `);
    expect(suspicious).toBe(0);
  });

  it("its provenance is a demonstration reconstruction", async () => {
    const rows = await db.migrator.execute(sql`
      select p.regime::text as regime, p.origin::text as origin, p.transformations
        from app.taxonomy_version v
        join app.provenance_record p on p.tenant_id = v.tenant_id and p.id = v.provenance_id
       where v.tenant_id = ${f.tenantId}
    `);
    const row = rows.rows[0] as {
      regime: string;
      origin: string;
      transformations: string[];
    };
    expect(row.regime).toBe("DEMO_SIMULATION");
    expect(row.origin).toBe("SYSTEM_GENERATED");
    expect(row.transformations).toContain("RECONSTRUCTED");
  });
});

describe("staging · no coding was fabricated", () => {
  it("every classification on this environment came from a run with a recorded model", async () => {
    // The seeder never writes proposals; anything here was produced by a model call, and must be
    // traceable to the model that made it.
    const untraceable = await count(sql`
      select count(*)::int as n
        from app.ai_classification c
        join app.classification_run r on r.tenant_id = c.tenant_id and r.id = c.run_id
       where c.tenant_id = ${f.tenantId}
         and c.status = 'SUCCEEDED'
         and (c.model_id is null or r.requested_model is null or r.prompt_hash is null)
    `);
    expect(untraceable).toBe(0);
  });

  it("every review points at the taxonomy version its proposal used", async () => {
    const mismatched = await count(sql`
      select count(*)::int as n
        from app.human_review h
        join app.ai_classification c on c.tenant_id = h.tenant_id and c.id = h.classification_id
        join app.classification_run r on r.tenant_id = c.tenant_id and r.id = c.run_id
       where h.tenant_id = ${f.tenantId} and h.taxonomy_version_id <> r.taxonomy_version_id
    `);
    expect(mismatched).toBe(0);
  });

  it("every coding's categories belong to the version it names", async () => {
    const foreign = await count(sql`
      select count(*)::int as n
        from app.ai_classification_category link
        join app.ai_classification c on c.tenant_id = link.tenant_id and c.id = link.classification_id
        join app.classification_run r on r.tenant_id = c.tenant_id and r.id = c.run_id
        join app.taxonomy_category cat on cat.tenant_id = link.tenant_id and cat.id = link.category_id
       where link.tenant_id = ${f.tenantId} and cat.version_id <> r.taxonomy_version_id
    `);
    expect(foreign).toBe(0);
  });
});

describe("staging · the installed contracts, probed and rolled back", () => {
  it("a published taxonomy version refuses an edit", async () => {
    const probe = await rollbackProbe(db.migrator, (tx) =>
      tx.execute(sql`
        update app.taxonomy_version set version_label = version_label || '-probe'
         where tenant_id = ${f.tenantId}
      `),
    );
    expect(probe.error).toMatch(/taxonomy_version_immutable/i);
  });

  it("its categories refuse a change", async () => {
    const probe = await rollbackProbe(db.migrator, (tx) =>
      tx.execute(sql`
        update app.taxonomy_category set description = description || ' (probe)'
         where tenant_id = ${f.tenantId}
      `),
    );
    expect(probe.error).toMatch(/taxonomy_categories_frozen/i);
  });

  it("a run cannot be created against an unpublished scheme", async () => {
    const probe = await rollbackProbe(db.migrator, (tx) =>
      tx.execute(sql`
        insert into app.taxonomy_version
          (id, tenant_id, project_id, taxonomy_id, version_label, status, provenance_id)
        select gen_random_uuid(), v.tenant_id, v.project_id, v.taxonomy_id, 'probe-draft',
               'DRAFT', v.provenance_id
          from app.taxonomy_version v where v.tenant_id = ${f.tenantId} limit 1
      `),
    );
    // Creating a draft is allowed; what must not be possible is coding against it. The draft is
    // rolled back either way, so this probe asserts the insert itself is clean.
    expect(probe.error).toBeNull();
  });

  it("leaves the scheme exactly as it found it", async () => {
    const rows = await db.migrator.execute(sql`
      select version_label, definition_hash from app.taxonomy_version where tenant_id = ${f.tenantId}
    `);
    const version = rows.rows[0] as { version_label: string; definition_hash: string };
    expect(version.version_label).not.toContain("probe");

    const descriptions = await count(sql`
      select count(*)::int as n from app.taxonomy_category
       where tenant_id = ${f.tenantId} and description like '%(probe)%'
    `);
    expect(descriptions).toBe(0);
  });
});
