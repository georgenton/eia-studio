#!/usr/bin/env node
/**
 * Provider-agnostic PostgreSQL capability probe (Slice 0.5, docs/STAGING_GATE_0_5.md).
 *
 * Verifies, against a real connection, everything EIA Studio's architecture depends on:
 * the ADR-004 privilege model (dedicated NOLOGIN policy owner, BYPASSRLS for it, an application
 * role that cannot bypass RLS), FORCE ROW LEVEL SECURITY, SECURITY DEFINER with a pinned
 * search_path, transaction-local `set_config(..., true)` semantics under the provider's
 * connection path, and the PostGIS / pgvector / pg_trgm extensions.
 *
 * Usage:  PROBE_DATABASE_URL=postgres://... node tooling/scripts/db-capability-probe.mjs
 *
 * It creates objects in a temporary schema `probe_<random>` and roles prefixed `probe_`, and
 * drops them again. It prints findings only — never the connection string or any password.
 */
import { randomBytes } from "node:crypto";

import pg from "pg";

const url = process.env.PROBE_DATABASE_URL;
if (!url) {
  console.error("PROBE_DATABASE_URL is required");
  process.exit(2);
}

const suffix = randomBytes(4).toString("hex");
const SCHEMA = `probe_${suffix}`;
const OWNER_ROLE = `probe_policy_${suffix}`;
const APP_ROLE = `probe_app_${suffix}`;
const LOGIN_ROLE = `probe_login_${suffix}`;
const LOGIN_PASSWORD = randomBytes(18).toString("hex");

const results = [];
function record(area, check, status, detail) {
  results.push({ area, check, status, detail });
  const mark = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "INFO";
  console.log(`[${mark}] ${area} · ${check}${detail ? ` — ${detail}` : ""}`);
}

async function attempt(client, sql) {
  try {
    await client.query(sql);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const admin = new pg.Client({
  connectionString: url,
  application_name: "eia-capability-probe",
  ssl: { rejectUnauthorized: false },
});

let loginClient = null;

try {
  await admin.connect();

  // ── connectivity and version ────────────────────────────────────────────────────────────
  const version = await admin.query(
    "select version() as v, current_setting('server_version_num') as num",
  );
  record("postgres", "version", "INFO", version.rows[0].v.split(" on ")[0]);
  const major = Math.floor(Number(version.rows[0].num) / 10000);
  record("postgres", "major version >= 15", major >= 15 ? "PASS" : "FAIL", `major=${major}`);

  const who = await admin.query(
    "select current_user as u, session_user as s, (select rolsuper from pg_roles where rolname = current_user) as super",
  );
  record(
    "postgres",
    "connected role privileges",
    "INFO",
    `current_user=${who.rows[0].u} superuser=${who.rows[0].super}`,
  );

  const ssl = await admin.query(
    "select ssl, version as tls, cipher from pg_stat_ssl where pid = pg_backend_pid()",
  );
  const sslRow = ssl.rows[0] ?? {};
  record(
    "postgres",
    "TLS connection",
    sslRow.ssl ? "PASS" : "FAIL",
    sslRow.ssl ? `${sslRow.tls} ${sslRow.cipher}` : "connection is not encrypted",
  );

  // ── pooling / session semantics ─────────────────────────────────────────────────────────
  const pid1 = await admin.query("select pg_backend_pid() as pid");
  const pid2 = await admin.query("select pg_backend_pid() as pid");
  record(
    "pooling",
    "stable backend pid on one connection",
    pid1.rows[0].pid === pid2.rows[0].pid ? "PASS" : "FAIL",
    `pid=${pid1.rows[0].pid}`,
  );
  const poolerHint = await admin.query(
    "select count(*)::int as n from pg_settings where name in ('pgbouncer.pool_mode','pooler.mode')",
  );
  record(
    "pooling",
    "no transaction pooler in front of this endpoint",
    poolerHint.rows[0].n === 0 ? "PASS" : "INFO",
    poolerHint.rows[0].n === 0
      ? "direct connection (session semantics available)"
      : "pooler settings visible",
  );

  await admin.query("begin");
  await admin.query("select set_config('app.probe_value', 'inside', true)");
  const inTx = await admin.query("select current_setting('app.probe_value', true) as v");
  await admin.query("commit");
  const afterTx = await admin.query("select current_setting('app.probe_value', true) as v");
  record(
    "pooling",
    "transaction-local set_config(..., true) is scoped to the transaction",
    inTx.rows[0].v === "inside" && (afterTx.rows[0].v ?? "") === "" ? "PASS" : "FAIL",
    `inside="${inTx.rows[0].v}" after="${afterTx.rows[0].v ?? ""}"`,
  );

  const maxConn = await admin.query("show max_connections");
  const reserved = await admin.query("show superuser_reserved_connections");
  record(
    "operational",
    "connection limits",
    "INFO",
    `max_connections=${maxConn.rows[0].max_connections} superuser_reserved=${reserved.rows[0].superuser_reserved_connections}`,
  );

  // ── extensions ──────────────────────────────────────────────────────────────────────────
  const available = await admin.query(
    "select name, default_version from pg_available_extensions where name in ('postgis','vector','pg_trgm') order by name",
  );
  const byName = Object.fromEntries(available.rows.map((r) => [r.name, r.default_version]));
  for (const ext of ["postgis", "vector", "pg_trgm"]) {
    record(
      "extensions",
      `${ext} available`,
      byName[ext] ? "PASS" : "FAIL",
      byName[ext] ? `default_version=${byName[ext]}` : "not offered by this image/provider",
    );
  }
  for (const ext of ["postgis", "vector", "pg_trgm"]) {
    if (!byName[ext]) continue;
    const err = await attempt(admin, `create extension if not exists ${ext}`);
    let installed = null;
    if (!err) {
      const r = await admin.query("select extversion from pg_extension where extname = $1", [ext]);
      installed = r.rows[0]?.extversion ?? null;
    }
    record(
      "extensions",
      `${ext} installable`,
      err ? "FAIL" : "PASS",
      err ?? `installed=${installed}`,
    );
  }

  // ── ADR-004 privilege model ─────────────────────────────────────────────────────────────
  let err = await attempt(admin, `create role ${APP_ROLE} nologin`);
  record("privileges", "ordinary role creation", err ? "FAIL" : "PASS", err ?? APP_ROLE);

  err = await attempt(admin, `create role ${OWNER_ROLE} nologin nosuperuser bypassrls noinherit`);
  record(
    "privileges",
    "NOLOGIN + BYPASSRLS policy-owner role (ADR-004 eia_policy)",
    err ? "FAIL" : "PASS",
    err ?? OWNER_ROLE,
  );

  err = await attempt(
    admin,
    `create role ${LOGIN_ROLE} login nosuperuser nobypassrls nocreatedb nocreaterole password '${LOGIN_PASSWORD}'`,
  );
  record("privileges", "runtime LOGIN role creation", err ? "FAIL" : "PASS", err ?? LOGIN_ROLE);
  if (!err) await attempt(admin, `grant ${APP_ROLE} to ${LOGIN_ROLE}`);

  const roleFlags = await admin.query(
    "select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = any($1) order by rolname",
    [[APP_ROLE, OWNER_ROLE, LOGIN_ROLE]],
  );
  for (const row of roleFlags.rows) {
    record(
      "privileges",
      `role flags ${row.rolname.replace(suffix, "*")}`,
      "INFO",
      `super=${row.rolsuper} bypassrls=${row.rolbypassrls} login=${row.rolcanlogin}`,
    );
  }
  const ownerRow = roleFlags.rows.find((r) => r.rolname === OWNER_ROLE);
  record(
    "privileges",
    "BYPASSRLS actually granted to the policy owner",
    ownerRow?.rolbypassrls ? "PASS" : "FAIL",
    `rolbypassrls=${ownerRow?.rolbypassrls}`,
  );

  // ── RLS + SECURITY DEFINER, mirroring migrations 0002/0004 ──────────────────────────────
  await admin.query(`create schema ${SCHEMA}`);
  await admin.query(`grant usage on schema ${SCHEMA} to ${APP_ROLE}, ${OWNER_ROLE}`);
  await admin.query(`create table ${SCHEMA}.tenant_row (tenant_id uuid not null, note text)`);
  await admin.query(`grant select, insert, update, delete on ${SCHEMA}.tenant_row to ${APP_ROLE}`);
  await admin.query(
    `insert into ${SCHEMA}.tenant_row values ('11111111-1111-4111-8111-111111111111','tenant A'),('22222222-2222-4222-8222-222222222222','tenant B')`,
  );

  err = await attempt(admin, `alter table ${SCHEMA}.tenant_row enable row level security`);
  record("rls", "ENABLE ROW LEVEL SECURITY", err ? "FAIL" : "PASS", err ?? undefined);
  err = await attempt(admin, `alter table ${SCHEMA}.tenant_row force row level security`);
  record("rls", "FORCE ROW LEVEL SECURITY", err ? "FAIL" : "PASS", err ?? undefined);

  err = await attempt(
    admin,
    `create function ${SCHEMA}.is_member(p_tenant uuid) returns boolean
     language sql stable security definer set search_path = pg_catalog, ${SCHEMA}, pg_temp as $$
       select p_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid
     $$`,
  );
  record("rls", "SECURITY DEFINER function creation", err ? "FAIL" : "PASS", err ?? undefined);

  err = await attempt(admin, `alter function ${SCHEMA}.is_member(uuid) owner to ${OWNER_ROLE}`);
  record(
    "rls",
    "assign function ownership to the policy owner",
    err ? "FAIL" : "PASS",
    err ?? undefined,
  );

  err = await attempt(
    admin,
    `alter function ${SCHEMA}.is_member(uuid) set search_path = pg_catalog, ${SCHEMA}, pg_temp`,
  );
  record(
    "rls",
    "explicit function search_path (pg_temp last)",
    err ? "FAIL" : "PASS",
    err ?? undefined,
  );

  const cfg = await admin.query(
    `select p.prosecdef, pg_get_userbyid(p.proowner) as owner, array_to_string(p.proconfig, ',') as cfg
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname = 'is_member'`,
    [SCHEMA],
  );
  record(
    "rls",
    "function metadata persisted as configured",
    cfg.rows[0]?.prosecdef &&
      cfg.rows[0].owner === OWNER_ROLE &&
      /pg_temp$/.test(cfg.rows[0].cfg ?? "")
      ? "PASS"
      : "FAIL",
    `secdef=${cfg.rows[0]?.prosecdef} owner=${cfg.rows[0]?.owner?.replace(suffix, "*")} cfg=${cfg.rows[0]?.cfg}`,
  );

  await attempt(admin, `revoke all on function ${SCHEMA}.is_member(uuid) from public`);
  await attempt(admin, `grant execute on function ${SCHEMA}.is_member(uuid) to ${APP_ROLE}`);
  const acl = await admin.query(
    `select coalesce(p.proacl::text,'DEFAULT') as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = $1 and p.proname = 'is_member'`,
    [SCHEMA],
  );
  record(
    "rls",
    "REVOKE EXECUTE FROM PUBLIC honoured",
    /(^|,)=/.test(acl.rows[0].acl.replace(/^\{|\}$/g, "")) ? "FAIL" : "PASS",
    acl.rows[0].acl.replace(new RegExp(suffix, "g"), "*"),
  );

  await admin.query(
    `create policy tenant_isolation on ${SCHEMA}.tenant_row for all
     using (${SCHEMA}.is_member(tenant_id)) with check (${SCHEMA}.is_member(tenant_id))`,
  );
  await admin.query(`grant execute on function ${SCHEMA}.is_member(uuid) to ${OWNER_ROLE}`);

  // ── behaviour as the runtime login role ─────────────────────────────────────────────────
  const u = new URL(url);
  u.username = LOGIN_ROLE;
  u.password = LOGIN_PASSWORD;
  loginClient = new pg.Client({
    connectionString: u.toString(),
    application_name: "eia-capability-probe-runtime",
    ssl: { rejectUnauthorized: false },
  });
  await loginClient.connect();

  const runtimeFlags = await loginClient.query(
    "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
  );
  record(
    "runtime",
    "runtime role is not superuser and lacks BYPASSRLS",
    !runtimeFlags.rows[0].rolsuper && !runtimeFlags.rows[0].rolbypassrls ? "PASS" : "FAIL",
    `super=${runtimeFlags.rows[0].rolsuper} bypassrls=${runtimeFlags.rows[0].rolbypassrls}`,
  );

  const setRole = await attempt(loginClient, `set role ${OWNER_ROLE}`);
  record(
    "runtime",
    "runtime cannot SET ROLE to the policy owner",
    setRole && /permission denied/i.test(setRole) ? "PASS" : "FAIL",
    setRole ?? "SET ROLE succeeded",
  );

  await loginClient.query("begin");
  await loginClient.query(
    "select set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true)",
  );
  const visible = await loginClient.query(`select count(*)::int as n from ${SCHEMA}.tenant_row`);
  const foreign = await loginClient.query(
    `select count(*)::int as n from ${SCHEMA}.tenant_row where tenant_id = '22222222-2222-4222-8222-222222222222'`,
  );
  await loginClient.query("commit");
  record(
    "runtime",
    "RLS isolates tenants under transaction-local context",
    visible.rows[0].n === 1 && foreign.rows[0].n === 0 ? "PASS" : "FAIL",
    `own=${visible.rows[0].n} foreign=${foreign.rows[0].n}`,
  );

  const noContext = await loginClient.query(`select count(*)::int as n from ${SCHEMA}.tenant_row`);
  record(
    "runtime",
    "missing context denies by default",
    noContext.rows[0].n === 0 ? "PASS" : "FAIL",
    `rows=${noContext.rows[0].n}`,
  );

  await loginClient.query("begin");
  await loginClient.query(
    "select set_config('app.tenant_id', '11111111-1111-4111-8111-111111111111', true)",
  );
  const foreignWrite = await attempt(
    loginClient,
    `insert into ${SCHEMA}.tenant_row values ('22222222-2222-4222-8222-222222222222','intruder')`,
  );
  await loginClient.query("rollback");
  record(
    "runtime",
    "WITH CHECK blocks a cross-tenant insert",
    foreignWrite && /row-level security/i.test(foreignWrite) ? "PASS" : "FAIL",
    foreignWrite ?? "insert succeeded",
  );

  const rlsOff = await attempt(
    loginClient,
    `begin; set local row_security = off; select count(*) from ${SCHEMA}.tenant_row; commit`,
  );
  await attempt(loginClient, "rollback");
  record(
    "runtime",
    "runtime cannot disable row_security",
    rlsOff && /row-level security/i.test(rlsOff) ? "PASS" : "FAIL",
    rlsOff ?? "row_security = off was accepted",
  );
} catch (error) {
  record(
    "probe",
    "unexpected failure",
    "FAIL",
    error instanceof Error ? error.message : String(error),
  );
} finally {
  if (loginClient) await loginClient.end().catch(() => {});
  await attempt(admin, `drop schema if exists ${SCHEMA} cascade`);
  for (const role of [LOGIN_ROLE, APP_ROLE, OWNER_ROLE]) {
    await attempt(admin, `drop owned by ${role}`);
    await attempt(admin, `drop role if exists ${role}`);
  }
  await admin.end().catch(() => {});
}

const failed = results.filter((r) => r.status === "FAIL");
console.log(
  `\n${results.filter((r) => r.status === "PASS").length} passed, ${failed.length} failed`,
);
if (failed.length > 0) {
  console.log("failed checks:");
  for (const f of failed) console.log(` - ${f.area} · ${f.check}: ${f.detail ?? ""}`);
}
process.exit(failed.length > 0 ? 1 : 0);
