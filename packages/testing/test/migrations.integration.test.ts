import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MIGRATIONS_FOLDER, runMigrations } from "@eia/db";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { attempt, getTestDatabase } from "../src/index";

const db = getTestDatabase();
afterAll(() => db.close());

/**
 * The number of applied migrations is read from the repository's journal rather than hardcoded:
 * the property under test is "the database matches the migrations folder", and a literal count
 * only re-states today's total and breaks on every future migration.
 */
const journalEntries = (
  JSON.parse(readFileSync(resolve(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8")) as {
    entries: ReadonlyArray<unknown>;
  }
).entries.length;

describe("migrations and database foundation", () => {
  it("required extensions are available and installed", async () => {
    const result = await db.migrator.execute(sql`
      select extname, extversion from pg_extension where extname in ('postgis', 'vector', 'pg_trgm') order by extname
    `);
    const names = result.rows.map((r) => (r as { extname: string }).extname);
    expect(names).toEqual(["pg_trgm", "postgis", "vector"]);
  });

  it("re-running migrations is a no-op", async () => {
    const before = await db.migrator.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    await runMigrations(db.info.migratorUrl);
    const after = await db.migrator.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);
    expect((after.rows[0] as { n: number }).n).toBe(journalEntries);
  });

  it("every table in app, audit and portal has RLS enabled, forced, and at least one policy", async () => {
    const result = await db.migrator.execute(sql`
      select n.nspname as schema, c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('app', 'audit', 'portal')
      order by 1, 2
    `);
    const rows = result.rows as Array<{
      schema: string;
      table: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
    }>;
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const row of rows) {
      expect(row.enabled, `${row.schema}.${row.table} rls enabled`).toBe(true);
      expect(row.forced, `${row.schema}.${row.table} rls forced`).toBe(true);
      expect(row.policies, `${row.schema}.${row.table} policies`).toBeGreaterThan(0);
    }
  });

  /**
   * IG1-009: `Project` is a canonical EIA Studio entity and must not carry demonstration state.
   * The simulation's as-of date lives with the calculation it anchors, on `forecast_snapshot`.
   */
  it("app.project carries no demo-specific column", async () => {
    const result = await db.migrator.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'app' and table_name = 'project'
      order by column_name
    `);
    const columns = (result.rows as Array<{ column_name: string }>).map((r) => r.column_name);
    expect(columns).not.toContain("demo_scenario_date");
    for (const column of columns) {
      expect(column, `app.project.${column}`).not.toMatch(/demo|scenario|simulation/i);
    }
    // …and the anchor is on the forecast, where a simulated calculation can own it.
    const forecast = await db.migrator.execute(sql`
      select column_name, is_nullable from information_schema.columns
      where table_schema = 'app' and table_name = 'forecast_snapshot' and column_name = 'as_of_date'
    `);
    expect(forecast.rows).toHaveLength(1);
    expect((forecast.rows[0] as { is_nullable: string }).is_nullable).toBe("NO");
  });

  it("roles follow least privilege (ADR-004)", async () => {
    const result = await db.migrator.execute(sql`
      select rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole
      from pg_roles where rolname in ('eia_app', 'eia_policy', ${db.info.runtimeRole}) order by rolname
    `);
    const roles = Object.fromEntries(
      (
        result.rows as Array<{
          rolname: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
          rolcanlogin: boolean;
          rolcreatedb: boolean;
          rolcreaterole: boolean;
        }>
      ).map((r) => [r.rolname, r]),
    );
    expect(roles.eia_app).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      rolcanlogin: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    expect(roles.eia_policy).toMatchObject({
      rolsuper: false,
      rolbypassrls: true,
      rolcanlogin: false,
    });
    expect(roles[db.info.runtimeRole]).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      rolcanlogin: true,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    const membership = await db.migrator.execute(sql`
      select count(*)::int as n from pg_auth_members m join pg_roles r on r.oid = m.roleid
      join pg_roles u on u.oid = m.member where r.rolname = 'eia_policy' and u.rolcanlogin
    `);
    expect((membership.rows[0] as { n: number }).n).toBe(0);
  });

  it("runtime role has no DDL privileges and cannot alter audit rows", async () => {
    const create = await attempt(
      db.runtime.execute(sql`create table app.should_not_exist (id int)`),
    );
    expect(create).toMatch(/permission denied/i);
    const schemaCreate = await db.runtime.execute(
      sql`select has_schema_privilege('app', 'CREATE') as can_create`,
    );
    expect((schemaCreate.rows[0] as { can_create: boolean }).can_create).toBe(false);
    const priv = await db.runtime.execute(sql`
      select has_table_privilege('audit.log', 'UPDATE') as upd, has_table_privilege('audit.log', 'DELETE') as del,
             has_table_privilege('audit.log', 'INSERT') as ins
    `);
    expect(priv.rows[0]).toMatchObject({ upd: false, del: false, ins: true });
  });

  it("every migration in the repository journal is applied to the database", async () => {
    const journal = await db.migrator.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect((journal.rows[0] as { n: number }).n).toBe(journalEntries);
    expect(journalEntries).toBeGreaterThanOrEqual(8);
  });
});
