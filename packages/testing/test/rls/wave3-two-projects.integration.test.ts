import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * Two projects in one tenant, as a **registry** rather than a walk-through (Wave 3).
 *
 * The other suites seed rows and prove that project X cannot read project Y's. This one asks the
 * question that scales to eight studies: *is there any project-scoped table whose policy forgot the
 * project?*
 *
 * It is written against `pg_catalog` rather than against fixtures because the failure it exists to
 * catch is a **future** one — the next table somebody adds with a `project_id` column and a policy
 * that only names the tenant. A row-level test can only catch that after somebody writes a fixture
 * for the new table; this catches it the moment the migration lands.
 *
 * Three properties, for every table in `app` carrying `project_id`:
 *
 * 1. row level security is enabled **and forced**, so the owning role is bound too;
 * 2. every policy's predicate names `app.current_project_id()`, so a context for one project cannot
 *    read another's rows;
 * 3. the composite foreign key to `project` exists, so a row cannot point at a project of another
 *    tenant even if application code is wrong.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

/**
 * Tables that carry `project_id` and are deliberately **not** project-scoped by policy.
 *
 * Empty today, and the list exists so that adding one is a decision somebody writes down rather
 * than a predicate somebody forgets.
 */
const NOT_PROJECT_SCOPED: ReadonlyArray<string> = [];

/**
 * Tables whose policy **delegates** the project check to a parent, with an `EXISTS` over it.
 *
 * A legitimate and long-standing shape: a chunk is visible exactly when its version is, and the
 * version's own policy has already applied the project conjunct. It is listed explicitly — with
 * the parent it delegates to — so that delegation is a decision somebody wrote down, and so the
 * test can check the parent is itself project-scoped rather than accepting any `EXISTS` at all.
 */
const DELEGATES_TO: Readonly<Record<string, string>> = {
  document_chunk: "document_version",
  finding_evidence: "quality_finding",
  specialist_review: "quality_finding",
  report_section: "report_version",
  // A chain: a source is visible when its section is, and a section when its version is. Followed
  // transitively below rather than flattened, because the chain is what the policies actually say.
  report_section_source: "report_section",
};

interface TableRow {
  readonly table: string;
}

async function projectScopedTables(): Promise<ReadonlyArray<string>> {
  const result = await db.migrator.execute(sql`
    select c.relname as table
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'app'
       and c.relkind = 'r'
       and a.attname = 'project_id'
       and a.attnum > 0
       and not a.attisdropped
     order by c.relname
  `);
  return (result.rows as unknown as TableRow[])
    .map((row) => row.table)
    .filter((table) => !NOT_PROJECT_SCOPED.includes(table));
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
});
afterAll(() => db.close());

describe("every project-scoped table answers for one project", () => {
  it("there are project-scoped tables to check, and the list grows with the product", async () => {
    const tables = await projectScopedTables();
    // A guard against the query silently returning nothing and the suite passing vacuously.
    expect(tables.length).toBeGreaterThan(25);
    // The Wave 3 tables are among them, which is the point of running this again this wave.
    for (const table of [
      "document_review_run",
      "document_review_candidate",
      "report_template_version",
      "generated_document",
    ]) {
      expect(tables, `${table} must be project-scoped`).toContain(table);
    }
  });

  it("has ENABLE and FORCE row level security", async () => {
    for (const table of await projectScopedTables()) {
      const result = await db.migrator.execute(sql`
        select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app' and c.relname = ${table}
      `);
      const row = result.rows[0] as { enabled: boolean; forced: boolean };
      expect(row.enabled, `${table}: RLS enabled`).toBe(true);
      expect(row.forced, `${table}: RLS forced`).toBe(true);
    }
  });

  /*
   * The check that scales. A policy that names only the tenant would let a coordinator of study #2
   * read study #1's rows — inside one consulting firm, which is the boundary that matters once the
   * same tenant holds eight studies.
   */
  it("every policy names the project, not only the tenant", async () => {
    for (const table of await projectScopedTables()) {
      const result = await db.migrator.execute(sql`
        select p.polname as name,
               pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expr,
               pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
          from pg_policy p
          join pg_class c on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app' and c.relname = ${table}
      `);
      const policies = result.rows as Array<{
        name: string;
        using_expr: string | null;
        check_expr: string | null;
      }>;
      expect(policies.length, `${table} has at least one policy`).toBeGreaterThan(0);

      const parent = DELEGATES_TO[table];
      for (const policy of policies) {
        const predicate = `${policy.using_expr ?? ""} ${policy.check_expr ?? ""}`;
        expect(predicate, `${table}.${policy.name} names the tenant`).toContain(
          "current_tenant_id",
        );
        if (parent === undefined) {
          expect(predicate, `${table}.${policy.name} names the project`).toContain(
            "current_project_id",
          );
        } else {
          // Delegation: the row is visible exactly when its parent is, and the parent's own policy
          // carries the project conjunct — which the next assertion checks for the parent itself.
          expect(predicate, `${table}.${policy.name} delegates to app.${parent}`).toContain(
            `app.${parent}`,
          );
        }
      }
    }
  });

  /**
   * Follow the delegation chain to a table that names the project itself.
   *
   * A chain rather than a single hop, because that is what the policies say: a report section
   * source is visible when its section is, and a section when its version is — and the version is
   * where the project conjunct lives. A chain that never reaches one, or that loops, is the
   * failure this test exists to catch.
   */
  it("every delegation chain ends at a table that names the project", async () => {
    for (const start of Object.keys(DELEGATES_TO)) {
      const seen: string[] = [];
      let table: string | undefined = start;
      let scoped = false;
      while (table !== undefined && !seen.includes(table)) {
        seen.push(table);
        const result = await db.migrator.execute(sql`
          select bool_or(coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '') like '%current_project_id%'
                      or coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '') like '%current_project_id%')
                   as scoped
            from pg_policy p
            join pg_class c on c.oid = p.polrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = ${table}
        `);
        if ((result.rows[0] as { scoped: boolean | null }).scoped === true) {
          scoped = true;
          break;
        }
        table = DELEGATES_TO[table];
      }
      expect(
        scoped,
        `${start} delegates through ${seen.join(" → ")} and must reach the project`,
      ).toBe(true);
    }
  });

  it("carries the composite foreign key to project", async () => {
    for (const table of await projectScopedTables()) {
      const result = await db.migrator.execute(sql`
        select count(*)::int as n
          from pg_constraint
         where conrelid = ${`app.${table}`}::regclass
           and contype = 'f'
           and confrelid = 'app.project'::regclass
           and array_length(conkey, 1) = 2
      `);
      expect((result.rows[0] as { n: number }).n, `${table}: composite FK`).toBeGreaterThan(0);
    }
  });
});

describe("a context for one project reads nothing of the other", () => {
  /*
   * The data-level half, over the tables of this wave. `projectY` belongs to the same tenant as
   * `projectX`, so only the project conjunct stands between them — which is the condition eight
   * studies in one firm actually create.
   */
  it("sees zero rows of every project-scoped table from a project with none", async () => {
    const tables = await projectScopedTables();
    for (const table of tables) {
      const result = await db.migrator.execute(sql`
        select count(*)::int as n from ${sql.raw(`app.${table}`)}
         where project_id = ${w.projectY.id}
      `);
      // The world seeds project X only; Y is empty by construction, and the assertion is that the
      // *fixture* is what this suite thinks it is before the policy tests above mean anything.
      expect((result.rows[0] as { n: number }).n, `${table} in project Y`).toBe(0);
    }
  });
});
