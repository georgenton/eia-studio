import {
  appEnvSchema,
  loadEnv,
  migratorDatabaseEnvSchema,
  runtimeDatabaseEnvSchema,
  socialEnvSchema,
} from "@eia/contracts";
import { createDatabase, createPool } from "@eia/db";
import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";
import { resolve } from "node:path";

import { buildRequestContext } from "../src/tenancy/request-context";
import { startClassificationRun } from "../src/social/use-cases";

/**
 * Start one classification run from the command line, as a named user.
 *
 * The operator equivalent of the button on the Social surface, and it takes exactly the same path:
 * the same `RequestContext`, the same capability and permission checks, the same demo-only gate.
 * It exists so a live smoke against a real provider is a deliberate, small, recorded action rather
 * than a browser session someone has to reproduce.
 *
 * The model and the classifier come from configuration (`SOCIAL_CLASSIFIER`,
 * `SOCIAL_CLASSIFIER_MODEL`) and are written onto the run, so a proposal can always be traced to
 * the configuration that produced it. Nothing here can widen a permission: a user without
 * `social.ai.run` is refused exactly as they would be in the browser.
 *
 *   pnpm social:run --email especialista@demo.invalid --tenant demo-consultancy \
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
  console.error("social:run: --email, --tenant and --project are required");
  process.exit(1);
}

const app = loadEnv("app", appEnvSchema);
const social = loadEnv("social", socialEnvSchema);
const database = loadEnv("database", runtimeDatabaseEnvSchema);
if (app.APP_ENV === "production") {
  console.error("social:run: not in production");
  process.exit(1);
}

const migrator = loadEnv("migrator", migratorDatabaseEnvSchema);
const pool = createPool(database.DATABASE_URL, { max: 2, applicationName: "eia-social-run" });
const db = createDatabase(pool);
// The identity lookup uses the migrator connection, like `provision:identity` does: `app.user` is
// behind RLS and there is no request context yet — that is precisely what is being built.
const lookupPool = createPool(migrator.DATABASE_MIGRATOR_URL, {
  max: 1,
  applicationName: "eia-social-run-lookup",
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

  // The taxonomy and the source question are resolved from the project, not passed in: the run
  // codes what this project actually has, and a mistyped id cannot aim it elsewhere.
  const taxonomy = await lookup.execute(sql`
    select id, version_label from app.taxonomy_version
     where tenant_id = ${ctx.tenantId} and project_id = ${ctx.projectId} and status = 'PUBLISHED'
     order by version_label desc limit 1
  `);
  const version = taxonomy.rows[0] as { id: string; version_label: string } | undefined;
  if (!version) throw new Error("this project has no published taxonomy version");

  const question = await lookup.execute(sql`
    select q.id, q.version_id, q.prompt
      from app.survey_question q
      join app.survey_version v on v.tenant_id = q.tenant_id and v.id = q.version_id
     where q.tenant_id = ${ctx.tenantId} and q.project_id = ${ctx.projectId}
       and q.type in ('SHORT_TEXT', 'LONG_TEXT') and v.status = 'PUBLISHED'
     order by v.version_label desc, q.ordinal limit 1
  `);
  const open = question.rows[0] as { id: string; version_id: string } | undefined;
  if (!open) throw new Error("this project has no open-text question on a published version");

  const started = await startClassificationRun(
    db,
    ctx,
    {
      taxonomyVersionId: version.id,
      surveyVersionId: open.version_id,
      questionId: open.id,
    },
    { model: social.SOCIAL_CLASSIFIER_MODEL, classifierKind: social.SOCIAL_CLASSIFIER },
  );

  console.log(
    `social:run: run ${started.runId} created · ${started.queued} queued · ` +
      `${started.skipped} skipped · taxonomy ${version.version_label} · ` +
      `model ${social.SOCIAL_CLASSIFIER_MODEL} · classifier ${social.SOCIAL_CLASSIFIER}`,
  );
} finally {
  await pool.end();
  await lookupPool.end();
}
