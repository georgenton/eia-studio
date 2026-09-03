import {
  appEnvSchema,
  loadEnv,
  migratorDatabaseEnvSchema,
  runtimeDatabaseEnvSchema,
} from "@eia/contracts";
import { createDatabase, createPool } from "@eia/db";
import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";
import { resolve } from "node:path";

import { runQualityCheck } from "../src/quality/run";
import { buildRequestContext } from "../src/tenancy/request-context";

/**
 * Run the quality rule set once, as a named user.
 *
 * The operator equivalent of "Ejecutar revisión" on the surface, taking exactly the same path: the
 * same `RequestContext`, the same capability and permission checks, the same reconciliation. It
 * exists so a demo environment can be brought to a reviewable state without a browser session, and
 * so the run is attributable to a real identity rather than to "the seeder".
 *
 *   pnpm quality:run --email coordinadora@demo.invalid --tenant demo-consultancy \
 *     --project puente-del-amor
 */
loadDotenv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = arg("email");
const tenantSlug = arg("tenant");
const projectSlug = arg("project");
if (!email || !tenantSlug || !projectSlug) {
  console.error("quality:run: --email, --tenant and --project are required");
  process.exit(1);
}

const app = loadEnv("app", appEnvSchema);
if (app.APP_ENV === "production") {
  console.error("quality:run: not in production");
  process.exit(1);
}

const database = loadEnv("database", runtimeDatabaseEnvSchema);
const migrator = loadEnv("migrator", migratorDatabaseEnvSchema);
const pool = createPool(database.DATABASE_URL, { max: 2, applicationName: "eia-quality-run" });
const db = createDatabase(pool);
// The identity lookup uses the migrator connection: `app.user` is behind RLS and there is no
// request context yet — that is precisely what is being built.
const lookupPool = createPool(migrator.DATABASE_MIGRATOR_URL, {
  max: 1,
  applicationName: "eia-quality-run-lookup",
});
const lookup = createDatabase(lookupPool);

try {
  const user = await lookup.execute(sql`select id, email from app."user" where email = ${email}`);
  const found = user.rows[0] as { id: string; email: string } | undefined;
  if (!found) throw new Error(`no application user with address ${email}`);

  const ctx = await buildRequestContext(db, {
    sessionUser: { subject: found.id, email: found.email, name: null, emailVerified: true },
    tenantSlug,
    projectSlug,
  });

  const result = await runQualityCheck(db, ctx);
  console.log(
    `quality:run: run ${result.runId} · ${result.created} nuevos · ${result.updated} actualizados · ` +
      `${result.reopened} reabiertos` +
      (result.skipped.length > 0
        ? ` · omitidas: ${result.skipped.map((s) => s.requirementKey).join(", ")}`
        : ""),
  );
} finally {
  await pool.end();
  await lookupPool.end();
}
