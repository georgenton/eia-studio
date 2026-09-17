import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getStagingDatabase } from "../../src/staging-fixture";

/**
 * What Wave 3 actually left on staging (ADR-035, ADR-036).
 *
 * Read-only, like every staging suite: no truncate, no seed, no repair, and every write inside a
 * transaction that rolls back (SECURITY.md §12a). What it asserts is the half of a migration that
 * a local run cannot vouch for — that the **grants, policies and triggers** are on the database an
 * operator is actually looking at, rather than on a throwaway container that agreed with them.
 *
 * The properties are the ones the two ADRs turn on: a model's suggestion is not editable, a
 * specialist's decision is not erasable, an activated template is frozen, and a generated document
 * is written once.
 */
const db = getStagingDatabase();
afterAll(() => db.close());

const REVIEW_TABLES = [
  "document_review_run",
  "document_review_source",
  "document_review_candidate",
  "document_review_evidence",
  "document_review_decision",
] as const;

const TEMPLATE_TABLES = [
  "report_template",
  "report_template_version",
  "generated_document",
] as const;

const ALL = [...REVIEW_TABLES, ...TEMPLATE_TABLES];

describe("Wave 3 tables exist on staging with their tenancy contract", () => {
  it("every one carries FORCE row level security", async () => {
    for (const table of ALL) {
      const result = await db.migrator.execute(sql`
        select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app' and c.relname = ${table}
      `);
      const row = result.rows[0] as { enabled: boolean; forced: boolean } | undefined;
      expect(row, `${table} exists`).toBeDefined();
      expect(row!.enabled, `${table}: RLS enabled`).toBe(true);
      expect(row!.forced, `${table}: RLS forced`).toBe(true);
    }
  });

  /*
   * The REVOKE is the load-bearing half (migration 0019's reasoning): 0002's default privileges
   * hand every new table in `app` full DML, so a narrower GRANT beside it changes nothing. Asserted
   * by privilege introspection on the real database rather than inferred from the migration file.
   */
  it("the runtime role holds no DELETE on any of them", async () => {
    for (const table of ALL) {
      const result = await db.migrator.execute(sql`
        select has_table_privilege('eia_app', ${`app.${table}`}, 'DELETE') as allowed
      `);
      expect((result.rows[0] as { allowed: boolean }).allowed, `${table}: DELETE`).toBe(false);
    }
  });

  it("only the rows that advance a state may be updated", async () => {
    const updatable = new Set([
      "document_review_run",
      "document_review_candidate",
      "report_template_version",
    ]);
    for (const table of ALL) {
      const result = await db.migrator.execute(sql`
        select has_table_privilege('eia_app', ${`app.${table}`}, 'UPDATE') as allowed
      `);
      expect((result.rows[0] as { allowed: boolean }).allowed, `${table}: UPDATE`).toBe(
        updatable.has(table),
      );
    }
  });

  it("the immutability triggers are installed and owned by the policy role", async () => {
    const triggers = await db.migrator.execute(sql`
      select t.tgname as name from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and not t.tgisinternal
         and (t.tgname like 'document_review%' or t.tgname like 'report_template%'
              or t.tgname like 'generated_document%')
       order by 1
    `);
    expect((triggers.rows as Array<{ name: string }>).map((row) => row.name)).toEqual([
      "document_review_candidate_no_delete",
      "document_review_candidate_state_only",
      "document_review_decision_no_delete",
      "document_review_decision_no_update",
      "document_review_evidence_no_delete",
      "document_review_evidence_no_update",
      "document_review_source_no_delete",
      "document_review_source_no_update",
      "generated_document_no_delete",
      "generated_document_no_update",
      "report_template_no_delete",
      "report_template_no_update",
      "report_template_version_identity_fixed",
      "report_template_version_no_delete",
    ]);

    const owners = await db.migrator.execute(sql`
      select distinct pg_get_userbyid(p.proowner) as owner from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app'
         and p.proname in ('document_review_candidate_state_only', 'document_review_write_once',
                           'document_review_candidate_no_delete', 'template_library_write_once',
                           'report_template_version_identity_fixed')
    `);
    expect((owners.rows as Array<{ owner: string }>).map((row) => row.owner)).toEqual([
      "eia_policy",
    ]);
  });

  /*
   * The third instance of the job boundary migration 0017 established. Four uuids and no content,
   * SECURITY DEFINER, owned by the NOLOGIN policy role, EXECUTE revoked from PUBLIC.
   */
  it("the AI review queue helper is the narrow one", async () => {
    const columns = await db.migrator.execute(sql`
      select arg.name as column, pg_catalog.format_type(arg.type, null) as type
        from pg_proc p,
             lateral unnest(p.proargnames, p.proallargtypes, p.proargmodes)
               with ordinality as arg(name, type, mode, ord)
       where p.proname = 'claim_document_review' and arg.mode = 't'
       order by arg.ord
    `);
    const typed = columns.rows as Array<{ column: string; type: string }>;
    expect(typed.map((row) => row.column)).toEqual([
      "run_id",
      "tenant_id",
      "project_id",
      "initiated_by_user_id",
    ]);
    for (const column of typed) expect(column.type, column.column).toBe("uuid");

    const hardening = await db.migrator.execute(sql`
      select p.prosecdef as security_definer,
             pg_get_userbyid(p.proowner) as owner,
             has_function_privilege('public', p.oid, 'EXECUTE') as public_execute
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'claim_document_review'
    `);
    const row = hardening.rows[0] as {
      security_definer: boolean;
      owner: string;
      public_execute: boolean;
    };
    expect(row.security_definer).toBe(true);
    expect(row.owner).toBe("eia_policy");
    expect(row.public_execute).toBe(false);
  });

  it("a justification is mandatory on an AI review decision", async () => {
    const result = await db.migrator.execute(sql`
      select pg_get_constraintdef(c.oid) as definition
        from pg_constraint c
       where c.conrelid = 'app.document_review_decision'::regclass
         and c.conname = 'document_review_decision_justification_check'
    `);
    expect((result.rows[0] as { definition: string } | undefined)?.definition).toContain("12");
  });

  /*
   * The storage namespaces are not mixed. A template, a generated draft and a delivered study are
   * three different things, and the enum is what makes a query for one unable to reach another.
   */
  it("the storage namespaces include templates and generated, and nothing else new", async () => {
    const result = await db.migrator.execute(sql`
      select e.enumlabel as label
        from pg_enum e join pg_type t on t.oid = e.enumtypid
        join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'app' and t.typname = 'storage_namespace'
       order by e.enumsortorder
    `);
    expect((result.rows as Array<{ label: string }>).map((row) => row.label)).toEqual([
      "documents",
      "field-media",
      "templates",
      "generated",
    ]);
  });

  it("holds no AI review candidate and no generated document yet", async () => {
    // Staging has had no run and no template activated. Stated rather than assumed, because a row
    // here would mean somebody exercised a live path on a persistent environment.
    for (const table of ["document_review_candidate", "generated_document"] as const) {
      const result = await db.migrator.execute(
        sql`select count(*)::int as n from ${sql.raw(`app.${table}`)}`,
      );
      expect((result.rows[0] as { n: number }).n, table).toBe(0);
    }
  });
});
