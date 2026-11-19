import {
  appEnvSchema,
  authEnvSchema,
  loadEnv,
  migratorDatabaseEnvSchema,
  runtimeDatabaseEnvSchema,
} from "@eia/contracts";
import { appSchema, authSchema, createDatabase, createPool } from "@eia/db";
import pg from "pg";
import { readFileSync } from "node:fs";
import { createTenant, slugSchema } from "@eia/application";
import { betterAuth } from "better-auth";
import { config as loadDotenv } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";

import { createAuthOptions } from "../lib/auth-options";

/**
 * The **first** account of a real deployment: one organisation, one owner, nothing else.
 *
 * ## Why this is a separate script from `provision:identity`
 *
 * They are mirror images, and the mirroring is the safety property.
 *
 * `provision:identity` exists so a reviewer can get into a demonstration: it **refuses
 * production** and accepts only synthetic address domains, so it can never create a real account.
 * This one is for the real environment: it accepts a real address and **refuses to run against a
 * database that already has an organisation**, so it can never be used as a day-to-day
 * administration tool, and it can never quietly add a second owner to somebody's live tenant.
 *
 * Neither script can do the other's job. That is deliberate: the day somebody reaches for the
 * wrong one, it says no rather than doing something plausible.
 *
 * ## What it creates, and what it deliberately does not
 *
 * Creates: the identity (through Better Auth's own sign-up, so the credential is hashed exactly
 * as a real one), its `app.user` row, the tenant with the plan's entitlements, and the `OWNER`
 * membership — through `createTenant`, the same use-case the product would call, so the audit
 * row and the capability rows are the product's own.
 *
 * Does not create: a project, a campaign, a questionnaire, a second person, or any fixture. A
 * production database with one organisation and one owner is the correct starting point; what
 * goes in it is the owner's to decide through the product.
 *
 * ## Public sign-up stays closed
 *
 * Sign-up is re-enabled **inside this process only** (IG0-H01). The deployed application is
 * untouched and still answers 400 to `POST /api/auth/sign-up/email`.
 *
 * ## Usage
 *
 *   OWNER_PASSWORD=… pnpm bootstrap:owner \
 *     --email persona@empresa.com --name "Nombre Apellido" \
 *     --org-slug mi-consultora --org-name "Mi Consultora S.A."
 *
 * Add `--dry-run` to report what it would do and write nothing.
 *
 * ## Reaching a database that is not on a public address
 *
 * A production database is not published, so it is reached through an SSH tunnel — and a tunnel
 * hides the host name, which is exactly what `sslmode=verify-full` checks. `--tls-servername`
 * supplies it: the certificate is still verified against the internal CA **and** its name is
 * still checked, against the name the operator states the tunnel leads to. Nothing is relaxed;
 * what would otherwise be missing is provided.
 *
 *   ssh -L 15434:<container>:5432 vps
 *   OWNER_PASSWORD=… pnpm bootstrap:owner … \
 *     --tls-servername <container> --tls-ca /ruta/ca.crt
 */
loadDotenv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

/** The domains `provision:identity` is restricted **to**; this script is restricted **from** them. */
const SYNTHETIC_EMAIL_DOMAINS = ["demo.invalid", "example.invalid", "factory.test", "test"];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dryRun = process.argv.includes("--dry-run");

const argsSchema = z
  .object({
    email: z.email(),
    name: z.string().trim().min(2).max(120),
    orgSlug: slugSchema,
    orgName: z.string().trim().min(2).max(120),
  })
  .strict();

const parsed = argsSchema.safeParse({
  email: arg("email"),
  name: arg("name"),
  orgSlug: arg("org-slug"),
  orgName: arg("org-name"),
});
if (!parsed.success) {
  console.error(`bootstrap:owner: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  console.error(
    "usage: OWNER_PASSWORD=… pnpm bootstrap:owner --email … --name … --org-slug … --org-name …",
  );
  process.exit(1);
}
const args = parsed.data;

const emailDomain = args.email.split("@")[1]?.toLowerCase() ?? "";
if (SYNTHETIC_EMAIL_DOMAINS.some((d) => emailDomain === d || emailDomain.endsWith(`.${d}`))) {
  console.error(
    "bootstrap:owner refused: this creates the real owner of a real deployment, and " +
      `${emailDomain} is a synthetic domain. Use provision:identity for demonstration identities.`,
  );
  process.exit(1);
}

const password = process.env.OWNER_PASSWORD;
if (!password || password.length < 12) {
  console.error("bootstrap:owner refused: set OWNER_PASSWORD (at least 12 characters)");
  process.exit(1);
}

const app = loadEnv("app", appEnvSchema);
const runtime = loadEnv("database", runtimeDatabaseEnvSchema);
const migrator = loadEnv("migrator", migratorDatabaseEnvSchema);
const auth = loadEnv("auth", authEnvSchema);

/*
 * Through a tunnel the TLS layer needs the name the certificate carries, because the address it
 * connected to is a loopback port. Supplying it keeps **both** checks: the chain against the CA,
 * and the certificate's own name. Without the flag this is the ordinary pool, unchanged.
 */
const tlsServername = arg("tls-servername");
const tlsCaPath = arg("tls-ca");
function tunnelledPool(connectionString: string): pg.Pool {
  if (!tlsServername) throw new Error("unreachable");
  /*
   * `sslmode` is removed from the string and the same intent expressed as an object, because
   * node-postgres builds its own TLS options from the string and they replace the ones passed
   * here. The guarantee is unchanged and spelled out: verify the chain against this CA, and
   * require the certificate to carry this name. The URL's `verify-full` has already been checked
   * by `runtimeDatabaseEnvSchema`, which is where that promise is kept.
   */
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  return new pg.Pool({
    connectionString: url.toString(),
    max: 1,
    application_name: "eia-bootstrap",
    ssl: {
      rejectUnauthorized: true,
      servername: tlsServername,
      ...(tlsCaPath ? { ca: readFileSync(tlsCaPath, "utf8") } : {}),
    },
  });
}

const runtimePool = tlsServername
  ? tunnelledPool(runtime.DATABASE_URL)
  : createPool(runtime.DATABASE_URL, { max: 1, applicationName: "eia-bootstrap" });
const migratorPool = tlsServername
  ? tunnelledPool(migrator.DATABASE_MIGRATOR_URL)
  : createPool(migrator.DATABASE_MIGRATOR_URL, {
      max: 1,
      applicationName: "eia-bootstrap",
      statementTimeoutMs: null,
    });
const runtimeDb = createDatabase(runtimePool);
const migratorDb = createDatabase(migratorPool);

try {
  /*
   * The one guard that matters. A database with an organisation already in it is not a database
   * this script may touch: adding an owner to somebody's live tenant is an administration act
   * with an audit trail and a human decision behind it, not a bootstrap.
   */
  const counted = await migratorDb
    .select({ count: sql<number>`count(*)::int` })
    .from(appSchema.tenant);
  const tenantCount = counted[0]?.count ?? 0;
  if (tenantCount > 0) {
    console.error(
      `bootstrap:owner refused: this database already has ${tenantCount} organisation(s). ` +
        "This script only ever creates the first one.",
    );
    process.exit(1);
  }

  console.log(`environment     ${app.APP_ENV}`);
  console.log(`organisation    ${args.orgName} (${args.orgSlug})`);
  console.log(`owner           ${args.name} <${args.email}>`);
  if (dryRun) {
    console.log("dry run: nothing was written. Remove --dry-run to apply.");
    process.exit(0);
  }

  // Sign-up is re-enabled for this process only; the deployed application keeps it closed.
  const identity = betterAuth({
    ...createAuthOptions({
      database: runtimeDb,
      baseURL: auth.BETTER_AUTH_URL,
      secret: auth.BETTER_AUTH_SECRET,
      trustedOrigins: auth.AUTH_TRUSTED_ORIGINS,
      secureCookies: false,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: false,
      minPasswordLength: 12,
    },
  });

  /*
   * The identity layer is asked whether the identity exists, not `app.user`: the two can disagree,
   * and `signUpEmail` collides with the first. A re-run after a partial failure therefore reuses
   * the identity and reconciles its credential rather than failing on "User already exists".
   */
  let userId: string;
  const existing = await migratorDb
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.email, args.email));
  if (existing[0]) {
    userId = existing[0].id;
    const ctx = await identity.$context;
    await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password));
    console.log("identity already existed; credential reconciled");
  } else {
    const created = await identity.api.signUpEmail({
      body: { email: args.email, password, name: args.name },
    });
    userId = created.user.id;
    console.log("identity created through Better Auth");
  }

  await migratorDb
    .insert(appSchema.user)
    .values({ id: userId, email: args.email, name: args.name })
    .onConflictDoNothing();

  /*
   * The product's own use-case, not a hand-written insert: it writes the tenant, the OWNER
   * membership, the plan's capability entitlements and the `tenant.created` audit row in one
   * transaction, under the RLS context the policies expect.
   */
  const result = await createTenant(
    migratorDb,
    { userId, requestId: randomUUID() },
    { slug: args.orgSlug, name: args.orgName },
  );

  console.log(`tenant          ${result.tenantId}`);
  console.log(`membership      ${result.membershipId} (OWNER)`);
  console.log(
    `done. Sign in at ${auth.BETTER_AUTH_URL}/sign-in — public sign-up remains disabled.`,
  );
} finally {
  await runtimePool.end();
  await migratorPool.end();
}
