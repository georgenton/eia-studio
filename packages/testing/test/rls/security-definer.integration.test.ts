import { createDatabase, createPool } from "@eia/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  attempt,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * IG0-B01: the SECURITY DEFINER membership helpers are a privileged boundary. These tests assert
 * the hardening contract of migration 0004 and probe the abuse paths a reviewer would try.
 *
 * Threat model: RLS and these helpers defend against application authorization bugs, forged
 * tenant/project context and accidental cross-tenant access. They do not claim to defend against
 * arbitrary SQL executed on an already-compromised runtime connection.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

/**
 * **Class 1 — membership predicates.** They answer one question about the caller, in `LANGUAGE
 * sql`, returning a boolean and nothing else. The strictest possible shape for a privileged
 * function: there is no row to leak, because the return type cannot carry one.
 */
const PRIVILEGED_PREDICATES = [
  "is_tenant_member",
  "is_tenant_admin",
  "is_tenant_owner",
  "has_project_membership",
  "has_project_access",
  "can_administer_project",
  "shares_tenant_with",
  "tenant_has_no_members",
] as const;

/**
 * **Class 2 — the background worker's job boundary (Slice 4).**
 *
 * A worker process has no session and no membership, so it cannot select a queue under RLS; and it
 * must not hold `BYPASSRLS`, which would trade a tenancy guarantee for a scheduling convenience.
 * These two functions are the narrow alternative, and they cannot be boolean: claiming work means
 * returning *which* work.
 *
 * What still holds, and is asserted below: fixed `search_path` without `public`, every object
 * schema-qualified, no dynamic SQL, `EXECUTE` revoked from PUBLIC, and — the rule that matters
 * most here — **every returned column is a uuid or a count**. No answer text, no category, no
 * response content crosses this boundary; the worker takes the identifiers and then does all of
 * its real reading inside an ordinary RLS transaction as the user who started the run.
 */
const PRIVILEGED_JOB_HELPERS = ["claim_classification", "release_stale_classifications"] as const;

const PRIVILEGED = [...PRIVILEGED_PREDICATES, ...PRIVILEGED_JOB_HELPERS] as const;

/** A login role with no grants at all: stands in for "any role that only has PUBLIC". */
const PROBE_ROLE = "eia_probe_public";
const PROBE_PASSWORD = "probe-only-no-grants-0123456789";
let probeUrl: string;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  const url = new URL(db.info.migratorUrl);
  const databaseName = url.pathname.slice(1);
  // Test-only role with no grants whatsoever: whatever it can do, PUBLIC can do.
  // Values are constants defined above, never external input.
  await dropProbeRole();
  await db.migrator.execute(
    sql.raw(`create role ${PROBE_ROLE} login password '${PROBE_PASSWORD}'`),
  );
  await db.migrator.execute(
    sql.raw(`grant connect on database "${databaseName}" to ${PROBE_ROLE}`),
  );
  url.username = PROBE_ROLE;
  url.password = PROBE_PASSWORD;
  probeUrl = url.toString();
});

afterAll(async () => {
  await dropProbeRole();
  await db.close();
});

/** DROP ROLE fails while the role still holds granted privileges, so drop those first. */
async function dropProbeRole(): Promise<void> {
  await db.migrator.execute(
    sql.raw(`do $$ begin
      if exists (select 1 from pg_roles where rolname = '${PROBE_ROLE}') then
        execute 'drop owned by ${PROBE_ROLE}';
        execute 'drop role ${PROBE_ROLE}';
      end if;
    end $$`),
  );
}

describe("hardening contract of the privileged helpers", () => {
  it("every SECURITY DEFINER function is owned by the dedicated NOLOGIN role", async () => {
    const result = await db.migrator.execute(sql`
      select p.proname as name, pg_get_userbyid(p.proowner) as owner, r.rolcanlogin as owner_can_login
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
      where n.nspname in ('app', 'audit') and p.prosecdef
      order by p.proname
    `);
    const rows = result.rows as Array<{ name: string; owner: string; owner_can_login: boolean }>;
    expect(rows.map((r) => r.name)).toEqual([...PRIVILEGED].sort());
    for (const row of rows) {
      expect(row.owner, row.name).toBe("eia_policy");
      expect(row.owner_can_login, row.name).toBe(false);
    }
  });

  it("every function pins a secure search_path with pg_catalog first and pg_temp last", async () => {
    const result = await db.migrator.execute(sql`
      select p.proname as name, p.prosecdef as secdef, array_to_string(p.proconfig, ',') as cfg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'audit') order by p.proname
    `);
    const rows = result.rows as Array<{ name: string; secdef: boolean; cfg: string | null }>;
    expect(rows.length).toBeGreaterThanOrEqual(13);
    for (const row of rows) {
      expect(row.cfg, `${row.name} must pin search_path`).toBeTruthy();
      const value = row.cfg!.replace("search_path=", "");
      const entries = value.split(",").map((s) => s.trim());
      expect(entries[0], `${row.name} first entry`).toBe("pg_catalog");
      expect(entries[entries.length - 1], `${row.name} last entry`).toBe("pg_temp");
      // only trusted, migrator-owned schemas may appear
      for (const entry of entries) expect(["pg_catalog", "app", "pg_temp"]).toContain(entry);
      expect(entries).not.toContain("public");
    }
  });

  it("PUBLIC cannot execute any helper; only the runtime group role is granted", async () => {
    const result = await db.migrator.execute(sql`
      select p.proname as name, coalesce(p.proacl::text, 'DEFAULT') as acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'audit') order by p.proname
    `);
    for (const row of result.rows as Array<{ name: string; acl: string }>) {
      // an ACL entry starting with "=" is the PUBLIC grant
      expect(row.acl, `${row.name} must not grant PUBLIC`).not.toMatch(/(^|,)=/);
      expect(row.acl, `${row.name} must not be DEFAULT (world-executable)`).not.toBe("DEFAULT");
    }
    const privileged = await db.migrator.execute(sql`
      select p.proname as name, has_function_privilege('eia_app', p.oid, 'EXECUTE') as app_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.prosecdef
    `);
    for (const row of privileged.rows as Array<{ name: string; app_exec: boolean }>) {
      expect(row.app_exec, row.name).toBe(true);
    }
  });

  it("the privileged owner owns no tables, schemas or sequences and no login role inherits it", async () => {
    const owned = await db.migrator.execute(sql`
      select count(*)::int as n from (
        select 1 from pg_class c where c.relowner = (select oid from pg_roles where rolname = 'eia_policy')
        union all
        select 1 from pg_namespace where nspowner = (select oid from pg_roles where rolname = 'eia_policy')
      ) t
    `);
    expect((owned.rows[0] as { n: number }).n).toBe(0);
    const members = await db.migrator.execute(sql`
      select count(*)::int as n from pg_auth_members m
      join pg_roles grantee on grantee.oid = m.member
      where m.roleid = (select oid from pg_roles where rolname = 'eia_policy')
    `);
    expect((members.rows[0] as { n: number }).n).toBe(0);
  });

  it("every membership predicate returns a boolean and nothing else", async () => {
    const result = await db.migrator.execute(sql`
      select p.proname as name, pg_catalog.format_type(p.prorettype, null) as rettype
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.prosecdef
        and p.proname not in (${sql.join(
          PRIVILEGED_JOB_HELPERS.map((name) => sql`${name}`),
          sql`, `,
        )})
    `);
    expect(result.rows.length).toBe(PRIVILEGED_PREDICATES.length);
    for (const row of result.rows as Array<{ name: string; rettype: string }>) {
      expect(row.rettype, row.name).toBe("boolean");
    }
  });

  it("the job helpers return identifiers and counts, never content", async () => {
    // The boundary a background worker crosses. `claim_classification` returns four uuids;
    // `release_stale_classifications` returns how many claims it released. A text column here
    // would mean an answer's words could leave the tenant's RLS envelope.
    // A RETURNS TABLE function keeps its output columns in proargnames/proargmodes ('t' = table
    // column), not in a composite type, so that is what this reads.
    const claim = await db.migrator.execute(sql`
      select arg.name as column, pg_catalog.format_type(arg.type, null) as type
        from pg_proc p,
             lateral unnest(p.proargnames, p.proallargtypes, p.proargmodes)
               with ordinality as arg(name, type, mode, ord)
       where p.proname = 'claim_classification' and arg.mode = 't'
       order by arg.ord
    `);
    const columns = claim.rows as Array<{ column: string; type: string }>;
    expect(columns.map((c) => c.column)).toEqual([
      "classification_id",
      "tenant_id",
      "project_id",
      "initiated_by_user_id",
    ]);
    for (const column of columns) expect(column.type, column.column).toBe("uuid");

    const release = await db.migrator.execute(sql`
      select pg_catalog.format_type(p.prorettype, null) as rettype
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'release_stale_classifications'
    `);
    expect((release.rows[0] as { rettype: string }).rettype).toBe("integer");
  });

  it("no helper body uses dynamic SQL", async () => {
    const result = await db.migrator.execute(sql`
      select p.proname as name, p.prosrc as src, l.lanname as lang
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
      where n.nspname = 'app' and p.prosecdef
    `);
    for (const row of result.rows as Array<{ name: string; src: string; lang: string }>) {
      // Membership predicates are plain SQL; the job helpers need control flow, so they are
      // plpgsql. Both are held to the rules that actually protect the boundary: no dynamic SQL,
      // no identifier interpolation, every relation schema-qualified.
      const isJobHelper = (PRIVILEGED_JOB_HELPERS as ReadonlyArray<string>).includes(row.name);
      expect(row.lang, row.name).toBe(isJobHelper ? "plpgsql" : "sql");
      // `EXECUTE` as a plpgsql statement is dynamic SQL; `FOR UPDATE ... ` is not. The job helpers
      // must not contain the former.
      expect(row.src.toLowerCase(), row.name).not.toMatch(
        /\bexecute\s+(?:'|format|quote)|format\s*\(|quote_ident/,
      );
      // every application relation reference is schema-qualified
      expect(row.src, row.name).not.toMatch(/\bfrom\s+(?!app\.)[a-z_]+\s/i);
    }
  });
});

describe("abuse paths", () => {
  it("a role with only PUBLIC privileges cannot execute the helpers or read the tables", async () => {
    const pool = createPool(probeUrl, { max: 1, applicationName: "eia-probe" });
    const probe = createDatabase(pool);
    try {
      for (const fn of ["is_tenant_member", "is_tenant_owner", "tenant_has_no_members"]) {
        const error = await attempt(
          probe.execute(sql`select ${sql.raw(`app.${fn}`)}(${w.tenantA.id}::uuid)`),
        );
        expect(error, fn).toMatch(/permission denied/i);
      }
      const projectFn = await attempt(
        probe.execute(
          sql`select app.has_project_access(${w.tenantA.id}::uuid, ${w.projectX.id}::uuid)`,
        ),
      );
      expect(projectFn).toMatch(/permission denied/i);
      const table = await attempt(probe.execute(sql`select count(*) from app.tenant`));
      expect(table).toMatch(/permission denied/i);
      const setting = await attempt(probe.execute(sql`select app.current_tenant_id()`));
      expect(setting).toMatch(/permission denied/i);
    } finally {
      await pool.end();
    }
  });

  it("the runtime role cannot become the privileged owner", async () => {
    expect(await attempt(db.runtime.execute(sql`set role eia_policy`))).toMatch(
      /permission denied/i,
    );
    expect(await attempt(db.runtime.execute(sql`set role postgres`))).toMatch(/permission denied/i);
    const membership = await db.runtime.execute(
      sql`select pg_has_role(current_user, 'eia_policy', 'MEMBER') as is_member`,
    );
    expect((membership.rows[0] as { is_member: boolean }).is_member).toBe(false);
  });

  it("the runtime role cannot create shadow objects where they would affect resolution", async () => {
    for (const schema of ["app", "audit", "public", "pg_catalog"]) {
      const priv = await db.runtime.execute(
        sql`select has_schema_privilege(${schema}, 'CREATE') as can_create`,
      );
      expect((priv.rows[0] as { can_create: boolean }).can_create, schema).toBe(false);
    }
    const create = await attempt(
      db.runtime.execute(sql`create table app.shadow_membership (x int)`),
    );
    expect(create).toMatch(/permission denied/i);
    const createPublic = await attempt(db.runtime.execute(sql`create table public.shadow (x int)`));
    expect(createPublic).toMatch(/permission denied/i);
  });

  it("a temporary table cannot shadow a relation used inside a definer function", async () => {
    // pg_temp is last in the search path AND every reference in the bodies is schema-qualified.
    // Even with a forged pg_temp.tenant_membership granting membership, the answer stays false.
    const pool = createPool(db.info.runtimeUrl, { max: 1, applicationName: "eia-shadow" });
    const single = createDatabase(pool);
    try {
      const shadowed = await single.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.user_id', ${w.ownerA.id}, true), set_config('app.tenant_id', ${w.tenantB.id}, true)`,
        );
        const created = await attempt(
          tx.execute(
            sql`create temporary table tenant_membership (tenant_id uuid, user_id uuid, status text, role text) on commit drop`,
          ),
        );
        if (created !== null) return { created, member: false, owner: false };
        await tx.execute(
          sql`insert into pg_temp.tenant_membership values (${w.tenantB.id}::uuid, ${w.ownerA.id}::uuid, 'active', 'OWNER')`,
        );
        const r = await tx.execute(
          sql`select app.is_tenant_member(${w.tenantB.id}::uuid) as member, app.is_tenant_owner(${w.tenantB.id}::uuid) as owner`,
        );
        return { created, ...(r.rows[0] as { member: boolean; owner: boolean }) };
      });
      expect(shadowed.member).toBe(false);
      expect(shadowed.owner).toBe(false);
    } finally {
      await pool.end();
    }
  });

  it("helpers called with arbitrary ids leak nothing across tenants", async () => {
    const probeIds = async (userId: string, ids: { tenant: string; project: string }) => {
      const pool = createPool(db.info.runtimeUrl, { max: 1, applicationName: "eia-abuse" });
      const single = createDatabase(pool);
      try {
        return await single.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
          const r = await tx.execute(sql`
            select app.is_tenant_member(${ids.tenant}::uuid) as member,
                   app.is_tenant_admin(${ids.tenant}::uuid) as admin,
                   app.is_tenant_owner(${ids.tenant}::uuid) as owner,
                   app.has_project_membership(${ids.tenant}::uuid, ${ids.project}::uuid) as pm,
                   app.has_project_access(${ids.tenant}::uuid, ${ids.project}::uuid) as access,
                   app.can_administer_project(${ids.tenant}::uuid, ${ids.project}::uuid) as admin_project,
                   app.tenant_has_no_members(${ids.tenant}::uuid) as empty,
                   app.shares_tenant_with(${w.ownerB.id}::uuid, ${ids.tenant}::uuid) as shares
          `);
          return r.rows[0] as Record<string, boolean>;
        });
      } finally {
        await pool.end();
      }
    };

    // Tenant A's OWNER pointing every helper at tenant B's ids: all false.
    const foreign = await probeIds(w.ownerA.id, { tenant: w.tenantB.id, project: w.projectZ.id });
    expect(Object.values(foreign).every((v) => v === false)).toBe(true);
    // `tenant_has_no_members` must not become an existence oracle for a foreign tenant that has
    // members: it answers false there, and false for an unknown id too.
    const unknown = await probeIds(w.ownerA.id, {
      tenant: "00000000-0000-4000-8000-000000000000",
      project: "00000000-0000-4000-8000-000000000001",
    });
    expect(unknown.empty).toBe(true); // unknown tenant genuinely has no members
    expect(unknown.member).toBe(false);
    expect(unknown.access).toBe(false);
    // positive control: the same helpers answer true for the caller's own tenant and project
    const own = await probeIds(w.memberA.id, { tenant: w.tenantA.id, project: w.projectX.id });
    expect(own.member).toBe(true);
    expect(own.pm).toBe(true);
    expect(own.access).toBe(true);
    expect(own.owner).toBe(false);
    expect(own.admin).toBe(false);
  });

  it("forged tenant/project settings do not widen what the helpers report", async () => {
    const pool = createPool(db.info.runtimeUrl, { max: 1, applicationName: "eia-forged" });
    const single = createDatabase(pool);
    try {
      const result = await single.transaction(async (tx) => {
        await tx.execute(sql`
          select set_config('app.user_id', ${w.memberA.id}, true),
                 set_config('app.tenant_id', ${w.tenantB.id}, true),
                 set_config('app.project_id', ${w.projectZ.id}, true)
        `);
        const r = await tx.execute(sql`
          select app.is_tenant_member(app.current_tenant_id()) as member,
                 app.has_project_access(app.current_tenant_id(), app.current_project_id()) as access,
                 (select count(*)::int from app.tenant where id = ${w.tenantB.id}) as foreign_tenants,
                 (select count(*)::int from app.project) as projects,
                 (select count(*)::int from app.tenant_membership where tenant_id = ${w.tenantB.id}) as foreign_memberships
        `);
        return r.rows[0] as {
          member: boolean;
          access: boolean;
          foreign_tenants: number;
          projects: number;
          foreign_memberships: number;
        };
      });
      // The forged tenant/project ids grant nothing: no membership, no project access, no row of
      // tenant B. (The caller still sees their OWN tenant through `is_tenant_member`, which is the
      // documented behaviour behind the tenant switcher, so only foreign rows are asserted here.)
      expect(result).toEqual({
        member: false,
        access: false,
        foreign_tenants: 0,
        projects: 0,
        foreign_memberships: 0,
      });
    } finally {
      await pool.end();
    }
  });
});
