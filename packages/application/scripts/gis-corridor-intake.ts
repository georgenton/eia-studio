import {
  appEnvSchema,
  loadEnv,
  migratorDatabaseEnvSchema,
  runtimeDatabaseEnvSchema,
} from "@eia/contracts";
import { createDatabase, createPool } from "@eia/db";
import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { activateDatasetVersion } from "../src/gis/activate-dataset-version";
import { applyCorridorIntake, planCorridorIntake } from "../src/gis/corridor-intake";
import { buildRequestContext } from "../src/tenancy/request-context";

/**
 * Operator-assisted corridor intake: `plan` reports, `apply` writes once.
 *
 * Thin on purpose, and the same shape as `quality:run`: every decision — permissions, RLS,
 * validation, the transaction, idempotency — lives in the use-case, and this file only reads a
 * local descriptor, builds the caller's `RequestContext` from a real identity, and prints what
 * happened. It is **not** the demonstration seeder: nothing here writes a metric, a forecast, an
 * activity feed, a campaign or a questionnaire.
 *
 * The writing connection is the runtime role, which has no BYPASSRLS. The migrator connection is
 * used for exactly one thing — looking up the actor's `app.user` row before a context exists —
 * which is the same concession `quality:run` makes and for the same reason.
 *
 *   pnpm --filter @eia/application gis:corridor-intake plan  ./descriptor.json
 *   pnpm --filter @eia/application gis:corridor-intake apply ./descriptor.json
 */
loadDotenv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

const [mode, descriptorPath] = process.argv.slice(2);
if ((mode !== "plan" && mode !== "apply") || descriptorPath === undefined) {
  console.error("gis:corridor-intake: usage <plan|apply> <descriptor.json>");
  process.exit(2);
}

const app = loadEnv("app", appEnvSchema);
if (app.APP_ENV === "production") {
  console.error("gis:corridor-intake: not in production");
  process.exit(1);
}

const descriptorFile = isAbsolute(descriptorPath)
  ? descriptorPath
  : resolve(process.cwd(), descriptorPath);
const descriptor = JSON.parse(readFileSync(descriptorFile, "utf8")) as Record<string, unknown>;
const base = dirname(descriptorFile);

function text(key: string): string {
  const value = descriptor[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`descriptor is missing ${key}`);
  }
  return value;
}

/** Layers are local, explicit paths. No URL is fetched. */
function layer(key: "alignment" | "parcels"): unknown {
  const rel = text(`${key}File`);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rel)) {
    throw new Error(`${key}File must be a local path, not a URL`);
  }
  return JSON.parse(readFileSync(resolve(base, rel), "utf8"));
}

const database = loadEnv("database", runtimeDatabaseEnvSchema);
const migrator = loadEnv("migrator", migratorDatabaseEnvSchema);
const pool = createPool(database.DATABASE_URL, { max: 2, applicationName: "eia-corridor-intake" });
const db = createDatabase(pool);
const lookupPool = createPool(migrator.DATABASE_MIGRATOR_URL, {
  max: 1,
  applicationName: "eia-corridor-intake-lookup",
});
const lookup = createDatabase(lookupPool);

try {
  const tenantSlug = text("tenantSlug");
  const projectSlug = text("projectSlug");
  const actorEmail = text("actorEmail");

  const user = await lookup.execute(
    sql`select id, email from app."user" where email = ${actorEmail}`,
  );
  const found = user.rows[0] as { id: string; email: string } | undefined;
  if (!found) throw new Error(`no application user with address ${actorEmail}`);

  const ctx = await buildRequestContext(db, {
    sessionUser: { subject: found.id, email: found.email, name: null, emailVerified: true },
    tenantSlug,
    projectSlug,
  });

  const input = {
    tenantSlug,
    projectSlug,
    sourceLabel: text("sourceLabel"),
    sourceSha256: text("sourceSha256"),
    receivedAt: text("receivedAt"),
    sourceSrid: Number(descriptor["sourceSrid"]),
    analysisSrid: Number(descriptor["analysisSrid"]),
    parcelCodeField: text("parcelCodeField"),
    condition:
      descriptor["condition"] === "FINAL" ? ("FINAL" as const) : ("PRELIMINARY_DRAFT" as const),
    alignmentLabel: text("alignmentLabel"),
    alignment: layer("alignment"),
    parcels: layer("parcels"),
    identityConfirmedForNewPackage: descriptor["identityConfirmedForNewPackage"] === true,
  };

  if (mode === "plan") {
    const plan = await planCorridorIntake(db, ctx, input);
    console.log(JSON.stringify(plan, null, 2));
    process.exit(plan.applicable ? 0 : 1);
  }

  const result = await applyCorridorIntake(db, ctx, input, {
    sourceSha256: input.sourceSha256,
    tenantSlug: input.tenantSlug,
    projectSlug: input.projectSlug,
  });
  if (result.applied && descriptor["activate"] === true) {
    // Activation is opt-in and reuses the existing use-case: an import nobody asked to show on
    // the map stays queryable and inactive.
    for (const id of [result.alignmentVersionId, result.parcelsVersionId]) {
      if (id !== null) await activateDatasetVersion(db, ctx, id);
    }
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
  await lookupPool.end();
}
