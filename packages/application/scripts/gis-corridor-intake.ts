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
import { dirname, resolve } from "node:path";

import { applyCorridorIntake, planCorridorIntake } from "../src/gis/corridor-intake";
import { buildRequestContext } from "../src/tenancy/request-context";
import { resolveDescriptorPath } from "./resolve-descriptor-path";

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

const [mode, descriptorPath, approvedFingerprint] = process.argv.slice(2);
if ((mode !== "plan" && mode !== "apply") || descriptorPath === undefined) {
  console.error(
    "gis:corridor-intake: usage\n" +
      "  plan  <descriptor.json>\n" +
      "  apply <descriptor.json> <fingerprint-of-the-approved-plan>",
  );
  process.exit(2);
}
if (mode === "apply" && (approvedFingerprint === undefined || approvedFingerprint.length !== 64)) {
  // The fingerprint is supplied by the operator who read the plan, not rebuilt from the descriptor
  // being applied. A command that approves its own input approves nothing.
  console.error("gis:corridor-intake: apply needs the fingerprint printed by an approved plan");
  process.exit(2);
}

const app = loadEnv("app", appEnvSchema);
if (app.APP_ENV === "production") {
  console.error("gis:corridor-intake: not in production");
  process.exit(1);
}

const descriptorFile = resolveDescriptorPath(descriptorPath, process.env, process.cwd());
let descriptorText: string;
try {
  descriptorText = readFileSync(descriptorFile, "utf8");
} catch {
  // A stack trace about `fs.readFileSync` tells an operator nothing. The path actually tried does.
  console.error(`gis:corridor-intake: no descriptor at ${descriptorFile}`);
  process.exit(1);
}
const descriptor = JSON.parse(descriptorText) as Record<string, unknown>;
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

/**
 * What this connection actually is, checked before anything is read or written.
 *
 * The previous rehearsal reached the owner's own development database because nothing said which
 * database was expected — it only failed later, on a missing user. A descriptor that names its
 * destination database is a cheap way to make "wrong environment" a refusal instead of a surprise,
 * and `rolbypassrls` is asserted because every guarantee below it assumes the caller cannot see
 * past RLS. Nothing here prints a URL or a credential.
 */
async function assertExpectedDatabase(): Promise<void> {
  const expected = text("expectedDatabase");
  const row = (
    await lookup.execute<{ db: string; usr: string; bypass: boolean }>(
      sql`select current_database() as db, current_user as usr,
                 (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
    )
  ).rows[0] as { db: string; usr: string; bypass: boolean } | undefined;
  if (row === undefined) throw new Error("could not identify the database");
  if (row.db !== expected) {
    throw new Error(`refusing: connected to database ${row.db}, descriptor expects ${expected}`);
  }
  if (/prod/i.test(row.db)) {
    // Independent of APP_ENV, which is a variable somebody can get wrong.
    throw new Error(`refusing: database ${row.db} looks like production`);
  }
  const runtime = (
    await db.execute<{ usr: string; bypass: boolean }>(
      sql`select current_user as usr,
                 (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
    )
  ).rows[0] as { usr: string; bypass: boolean } | undefined;
  if (runtime === undefined) throw new Error("could not identify the runtime connection");
  if (runtime.bypass === true) {
    throw new Error(`refusing: the runtime role ${runtime.usr} can bypass row level security`);
  }
  console.error(
    `gis:corridor-intake: database ${row.db} · runtime role ${runtime.usr} (no bypassrls)`,
  );
}

try {
  await assertExpectedDatabase();
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
    activate: descriptor["activate"] === true,
  };

  if (mode === "plan") {
    const plan = await planCorridorIntake(db, ctx, input);
    console.log(JSON.stringify(plan, null, 2));
    process.exit(plan.applicable ? 0 : 1);
  }

  // Activation, when asked for, happens inside the use-case's own transaction.
  const result = await applyCorridorIntake(db, ctx, input, approvedFingerprint as string);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
  await lookupPool.end();
}
