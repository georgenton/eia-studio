import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MIGRATIONS_FOLDER } from "@eia/db";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { assertNotStampedEphemeral, getStagingDatabase } from "../../src/staging-fixture";
import { FIELD_TABLES } from "./fixture";

/**
 * What is actually installed on the persistent environment.
 *
 * Read-only throughout: catalogue queries only, no DDL, no seed, no reset. The question these
 * answer is whether staging carries the schema this branch expects — the migration ledger at the
 * repository's head, the field tables present, row level security enabled *and forced* on each,
 * and the functions and triggers the isolation and immutability contracts depend on.
 */
const db = getStagingDatabase();
afterAll(() => db.close());

const journalEntries = (
  JSON.parse(readFileSync(resolve(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8")) as {
    entries: ReadonlyArray<{ tag: string }>;
  }
).entries;

describe("staging · migration state", () => {
  it("is not stamped as an ephemeral test database", async () => {
    // The other half of the split: a persistent environment must never carry the marker that
    // authorises a destructive reset (IG3-001).
    await expect(assertNotStampedEphemeral(db.migrator)).resolves.toBeUndefined();
  });

  it("the migration ledger is at the repository's head", async () => {
    const result = await db.migrator.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect((result.rows[0] as { n: number }).n).toBe(journalEntries.length);
  });

  it("required extensions are installed", async () => {
    const result = await db.migrator.execute(sql`
      select extname from pg_extension where extname in ('postgis', 'vector', 'pg_trgm')
      order by extname
    `);
    expect(result.rows.map((r) => (r as { extname: string }).extname)).toEqual([
      "pg_trgm",
      "postgis",
      "vector",
    ]);
  });
});

describe("staging · field tables and their row level security", () => {
  it("every Slice 3 table exists with RLS enabled, forced, and policies", async () => {
    const result = await db.migrator.execute(sql`
      select c.relname as table,
             c.relrowsecurity as enabled,
             c.relforcerowsecurity as forced,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname = 'app'
        and c.relname in (${sql.join(
          FIELD_TABLES.map((name) => sql`${name}`),
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

    expect(rows.map((r) => r.table)).toEqual([...FIELD_TABLES].sort());
    for (const row of rows) {
      expect(row.enabled, `${row.table} rls enabled`).toBe(true);
      expect(row.forced, `${row.table} rls forced`).toBe(true);
      expect(row.policies, `${row.table} policies`).toBeGreaterThanOrEqual(2);
    }
  });

  it("no table anywhere in app or audit is left without forced RLS", async () => {
    const result = await db.migrator.execute(sql`
      select n.nspname || '.' || c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('app', 'audit')
        and (c.relrowsecurity = false or c.relforcerowsecurity = false
             or (select count(*) from pg_policy p where p.polrelid = c.oid) = 0)
      order by 1
    `);
    expect(result.rows.map((r) => (r as { name: string }).name)).toEqual([]);
  });

  it("the functions the field policies call are installed", async () => {
    const result = await db.migrator.execute(sql`
      select p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname in ('can_read_field_responses', 'has_project_access', 'current_user_id',
                          'current_tenant_id', 'current_project_id')
      order by 1
    `);
    expect(result.rows.map((r) => (r as { name: string }).name)).toEqual([
      "can_read_field_responses",
      "current_project_id",
      "current_tenant_id",
      "current_user_id",
      "has_project_access",
    ]);
  });

  it("the immutability and answer-typing triggers are installed", async () => {
    const result = await db.migrator.execute(sql`
      select t.tgname as name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and not t.tgisinternal
        and t.tgname in ('survey_version_immutable', 'survey_question_frozen',
                         'survey_option_frozen', 'survey_instance_rules',
                         'survey_answer_editable', 'survey_answer_option_editable',
                         'survey_answer_matches_question')
      order by 1
    `);
    expect(result.rows.map((r) => (r as { name: string }).name)).toEqual([
      "survey_answer_editable",
      "survey_answer_matches_question",
      "survey_answer_option_editable",
      "survey_instance_rules",
      "survey_option_frozen",
      "survey_question_frozen",
      "survey_version_immutable",
    ]);
  });

  it("every provenance-bearing field row is held by a foreign key", async () => {
    const result = await db.migrator.execute(sql`
      select conname as name from pg_constraint
      where contype = 'f' and conname in (
        'survey_version_provenance_fk', 'survey_campaign_provenance_fk',
        'field_assignment_provenance_fk', 'field_visit_provenance_fk',
        'survey_instance_provenance_fk')
      order by 1
    `);
    expect(result.rows).toHaveLength(5);
  });

  it("the runtime role holds no privilege it should not", async () => {
    const result = await db.migrator.execute(sql`
      select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
      from pg_roles where rolname = ${db.info.runtimeRole}
    `);
    expect(result.rows[0]).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });
});
