import { loadEnv, migratorDatabaseEnvSchema } from "@eia/contracts";
import { createDatabase, createPool, MIGRATIONS_FOLDER } from "@eia/db";
import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The checks that are about the *environment*, not about the data.
 *
 *   pnpm demo:preflight
 *
 * `demo:doctor` answers "does this project have what the walkthrough shows?". This answers "is this
 * environment the one I think it is, and is it in step with the code I am about to describe?" —
 * which is the question that has actually gone wrong: a staging database two migrations behind a
 * `main` that has since been demonstrated from a laptop.
 *
 * **Read-only.** Selects and file reads. It changes nothing, in any environment.
 */
loadDotenv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

type Level = "OK" | "WARN" | "FAIL";
const rows: Array<{ level: Level; check: string; detail: string }> = [];
const report = (level: Level, check: string, detail: string) => rows.push({ level, check, detail });

const migrator = loadEnv("migrator", migratorDatabaseEnvSchema);
const pool = createPool(migrator.DATABASE_MIGRATOR_URL, {
  max: 1,
  applicationName: "eia-demo-preflight",
  statementTimeoutMs: 15_000,
});
const db = createDatabase(pool);

/** The host, without its credentials — enough to know *which* database, never enough to open it. */
function targetLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "(no interpretable)";
  }
}

try {
  report("OK", "base de datos", targetLabel(migrator.DATABASE_MIGRATOR_URL));

  /* ── schema parity ──────────────────────────────────────────────────────────────────────── */
  const journal = (
    JSON.parse(readFileSync(resolve(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8")) as {
      entries: ReadonlyArray<unknown>;
    }
  ).entries.length;
  const applied = await db.execute(
    sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
  );
  const n = (applied.rows[0] as { n: number }).n;
  report(
    n === journal ? "OK" : "FAIL",
    "esquema",
    n === journal
      ? `${n} migraciones, al día con el repositorio`
      : `la base tiene ${n} migraciones y el repositorio ${journal}: aplicar antes de demostrar`,
  );

  /* ── the extensions the map and the search depend on ────────────────────────────────────── */
  const extensions = await db.execute(sql`
    select extname from pg_extension where extname in ('postgis', 'pg_trgm') order by 1
  `);
  const names = (extensions.rows as Array<{ extname: string }>).map((r) => r.extname);
  report(
    names.includes("postgis") ? "OK" : "FAIL",
    "extensiones",
    names.length > 0 ? names.join(", ") : "ninguna de las esperadas",
  );

  /* ── the runtime role, which is what the application actually connects as ───────────────── */
  const role = await db.execute(sql`
    select rolname, rolsuper, rolbypassrls from pg_roles
     where rolname in ('eia_app', 'eia_policy') order by rolname
  `);
  const roles = role.rows as Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>;
  const appRole = roles.find((r) => r.rolname === "eia_app");
  report(
    appRole && !appRole.rolsuper && !appRole.rolbypassrls ? "OK" : "FAIL",
    "rol de ejecución",
    appRole
      ? `eia_app · superuser=${appRole.rolsuper} · bypassrls=${appRole.rolbypassrls}`
      : "no existe eia_app",
  );

  /* ── row level security, everywhere ─────────────────────────────────────────────────────── */
  const unprotected = await db.execute(sql`
    select count(*)::int as n
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where c.relkind = 'r' and ns.nspname in ('app', 'audit')
       and (not c.relrowsecurity or not c.relforcerowsecurity)
  `);
  const open = (unprotected.rows[0] as { n: number }).n;
  report(
    open === 0 ? "OK" : "FAIL",
    "aislamiento",
    open === 0 ? "RLS activo y forzado en todas las tablas" : `${open} tabla(s) sin RLS forzado`,
  );

  /* ── where the walkthrough will be shown from ───────────────────────────────────────────── */
  const preview = process.env.PREVIEW_URL ?? process.env.PUBLIC_APP_URL;
  report(
    preview ? "OK" : "WARN",
    "dirección de la demostración",
    preview ?? "sin PREVIEW_URL ni PUBLIC_APP_URL: confirmar a mano antes de la reunión",
  );

  const password = process.env.DEMO_USER_PASSWORD;
  report(
    password && password.length >= 12 ? "OK" : "WARN",
    "credencial de las identidades",
    password ? "presente en el entorno (no se imprime)" : "ausente: no se podrá iniciar sesión",
  );

  /* ── output ─────────────────────────────────────────────────────────────────────────────── */
  const width = Math.max(...rows.map((r) => r.check.length));
  console.log(`\ndemo:preflight\n`);
  for (const row of rows)
    console.log(`${row.level.padEnd(4)} ${row.check.padEnd(width)}  ${row.detail}`);
  const failures = rows.filter((r) => r.level === "FAIL").length;
  console.log(`\n${rows.length} comprobaciones · ${failures} FAIL\n`);
  console.log("Después de esto: `pnpm demo:doctor` sobre el mismo entorno.\n");
  if (failures > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
