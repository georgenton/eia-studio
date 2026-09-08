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

import { buildClientPublicationDraft } from "../src/portal/build";
import { publishClientPublication } from "../src/portal/publish";
import { buildRequestContext } from "../src/tenancy/request-context";

/**
 * Publish one update to the client portal, as a named user.
 *
 * The operator equivalent of pressing *Publicar actualización*, taking exactly the same path: the
 * same `RequestContext`, the same capability and permission checks, the same builder, the same
 * validation and the same audit row. It exists so a demonstration environment can be brought to a
 * reviewable state without a browser session — and so the publication is attributable to a real
 * identity rather than to "the seeder", which is the whole point of a publication being a decision.
 *
 * `--dry-run` builds the draft and prints what it would say, without writing anything. Use it
 * before publishing to a persistent environment: it names every figure and every withheld one.
 *
 *   pnpm portal:publish --email coordinadora@demo.invalid --tenant demo-consultancy \
 *     --project puente-del-amor [--dry-run]
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
const dryRun = process.argv.includes("--dry-run");
if (!email || !tenantSlug || !projectSlug) {
  console.error("portal:publish: --email, --tenant and --project are required");
  process.exit(1);
}

const app = loadEnv("app", appEnvSchema);
if (app.APP_ENV === "production") {
  console.error("portal:publish: not in production");
  process.exit(1);
}

const database = loadEnv("database", runtimeDatabaseEnvSchema);
const migrator = loadEnv("migrator", migratorDatabaseEnvSchema);
const pool = createPool(database.DATABASE_URL, { max: 2, applicationName: "eia-portal-publish" });
const db = createDatabase(pool);
// The identity lookup uses the migrator connection: `app.user` is behind RLS and there is no
// request context yet — that is precisely what is being built.
const lookupPool = createPool(migrator.DATABASE_MIGRATOR_URL, {
  max: 1,
  applicationName: "eia-portal-publish-lookup",
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

  const draft = await buildClientPublicationDraft(db, ctx);
  const facts = [
    ...draft.payload.summary.facts,
    ...draft.payload.participation.facts,
    ...(draft.payload.managementPlan?.facts ?? []),
  ];
  console.log(
    `portal:publish: la actualización diría → ${facts
      .map((fact) => `${fact.label}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ""}`)
      .join(" · ")}`,
  );
  console.log(
    `portal:publish: territorio → ${draft.payload.territory.alignment ? "1 trazado" : "sin trazado"}` +
      ` · ${draft.payload.territory.influenceAreas.length} área(s) delimitada(s)`,
  );
  for (const withheld of draft.withheld) {
    console.log(`portal:publish: no se publica → ${withheld.label}: ${withheld.reason}`);
  }

  if (dryRun) {
    console.log("portal:publish: --dry-run, no se escribió nada");
  } else {
    const result = await publishClientPublication(db, ctx);
    console.log(
      `portal:publish: publicada ${result.versionLabel} · ${result.publishedAt.toISOString()}` +
        (result.unchangedFromPrevious ? " · idéntica a la anterior" : ""),
    );
  }
} finally {
  await pool.end();
  await lookupPool.end();
}
