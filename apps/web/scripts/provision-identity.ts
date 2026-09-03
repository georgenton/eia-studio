import {
  appEnvSchema,
  authEnvSchema,
  loadEnv,
  migratorDatabaseEnvSchema,
  runtimeDatabaseEnvSchema,
} from "@eia/contracts";
import { appSchema, authSchema, createDatabase, createPool } from "@eia/db";
import { PROJECT_ROLES, TENANT_ROLES } from "@eia/domain";
import { betterAuth } from "better-auth";
import { config as loadDotenv } from "dotenv";
import { and, eq } from "drizzle-orm";
import { resolve } from "node:path";
import { z } from "zod";

import { createAuthOptions } from "../lib/auth-options";

/**
 * Provision a synthetic demo identity and its EIA Studio memberships (Slice 1, §4).
 *
 * Why this script exists: public self-signup is disabled (IG0-H01), so there is no way for a
 * reviewer to obtain an account. This is the operator path, and it is deliberately explicit:
 *
 *   * the password is read from `DEMO_USER_PASSWORD` in the environment and is never written to
 *     the repository, to a log line or to the command output;
 *   * it refuses to run against `APP_ENV=production` and against any address that is not on the
 *     synthetic demo domain, so it can only ever create test identities;
 *   * the identity is created through Better Auth's own sign-up API (with sign-up re-enabled for
 *     this process only), so the credential account is hashed exactly as a real one;
 *   * the domain rows — `app.user`, `TenantMembership`, optional `ProjectMembership` — are
 *     written with the migrator connection, because authorization state is never derived from
 *     the identity provider (ADR-010).
 *
 * Usage:
 *   DEMO_USER_PASSWORD=… pnpm provision:identity \
 *     --email coordinador@demo.invalid --name "Coordinadora de proyecto" \
 *     --tenant demo-consultancy --tenant-role OWNER \
 *     --project puente-del-amor --project-role COORDINATOR
 */
loadDotenv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

const ALLOWED_EMAIL_DOMAINS = ["demo.invalid", "example.invalid", "factory.test"];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const argsSchema = z
  .object({
    email: z.email(),
    name: z.string().min(2),
    tenant: z.string().min(1),
    tenantRole: z.enum(TENANT_ROLES),
    project: z.string().min(1).optional(),
    projectRole: z.enum(PROJECT_ROLES).optional(),
  })
  .strict()
  .refine((v) => (v.project === undefined) === (v.projectRole === undefined), {
    message: "--project and --project-role must be given together",
  });

const parsed = argsSchema.safeParse({
  email: arg("email"),
  name: arg("name"),
  tenant: arg("tenant"),
  tenantRole: arg("tenant-role"),
  ...(arg("project") === undefined ? {} : { project: arg("project") }),
  ...(arg("project-role") === undefined ? {} : { projectRole: arg("project-role") }),
});
if (!parsed.success) {
  console.error(`provision:identity: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  process.exit(1);
}
const args = parsed.data;

const app = loadEnv("app", appEnvSchema);
if (app.APP_ENV === "production") {
  console.error("provision:identity refused: never provision synthetic identities in production");
  process.exit(1);
}
const emailDomain = args.email.split("@")[1] ?? "";
if (!ALLOWED_EMAIL_DOMAINS.includes(emailDomain)) {
  console.error(
    `provision:identity refused: only synthetic addresses are allowed (${ALLOWED_EMAIL_DOMAINS.join(", ")})`,
  );
  process.exit(1);
}
const password = process.env.DEMO_USER_PASSWORD;
if (!password || password.length < 12) {
  console.error("provision:identity refused: set DEMO_USER_PASSWORD (at least 12 characters)");
  process.exit(1);
}

const runtime = loadEnv("database", runtimeDatabaseEnvSchema);
const migrator = loadEnv("migrator", migratorDatabaseEnvSchema);
const auth = loadEnv("auth", authEnvSchema);

const runtimePool = createPool(runtime.DATABASE_URL, { max: 1, applicationName: "eia-provision" });
const migratorPool = createPool(migrator.DATABASE_MIGRATOR_URL, {
  max: 1,
  applicationName: "eia-provision",
});
const runtimeDb = createDatabase(runtimePool);
const migratorDb = createDatabase(migratorPool);

try {
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

  // The identity layer is the authority on whether an identity exists, because that is what
  // `signUpEmail` collides with. Checking `app.user` instead was wrong in a way only a reseed
  // reveals: the two tables can disagree — the application rows can be rebuilt while `auth` keeps
  // its own — after which provisioning fails with "User already exists" for a user the app cannot
  // see. So the question is always put to `auth.user`.
  let userId: string;
  const existingIdentity = await migratorDb
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.email, args.email));
  if (existingIdentity[0]) {
    userId = existingIdentity[0].id;
    // Reconcile the credential to the supplied password rather than leaving the old one in place.
    // Without this, an operator who no longer knows the previous DEMO_USER_PASSWORD has only one
    // way back into the environment — deleting the identities and re-creating them — and on a
    // persistent environment that is precisely the destruction IG3-001 is about. Re-provisioning
    // is idempotent either way: the same password re-hashes to an equivalent credential.
    const ctx = await identity.$context;
    await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password));
    console.log("identity already exists; credential reconciled and memberships ensured");
  } else {
    const created = await identity.api.signUpEmail({
      body: { email: args.email, password, name: args.name },
    });
    userId = created.user.id;
    console.log("identity created through Better Auth");
  }

  await migratorDb.transaction(async (tx) => {
    await tx
      .insert(appSchema.user)
      .values({ id: userId, email: args.email, name: args.name })
      .onConflictDoNothing();

    const tenants = await tx
      .select({ id: appSchema.tenant.id })
      .from(appSchema.tenant)
      .where(eq(appSchema.tenant.slug, args.tenant));
    const tenantId = tenants[0]?.id;
    if (!tenantId) throw new Error(`tenant ${args.tenant} not found; run db:seed:dev first`);

    const [membership] = await tx
      .insert(appSchema.tenantMembership)
      .values({ tenantId, userId, role: args.tenantRole, status: "active" })
      .onConflictDoUpdate({
        target: [appSchema.tenantMembership.tenantId, appSchema.tenantMembership.userId],
        set: { role: args.tenantRole, status: "active" },
      })
      .returning({ id: appSchema.tenantMembership.id });
    const tenantMembershipId = membership!.id;

    if (args.project && args.projectRole) {
      const projects = await tx
        .select({ id: appSchema.project.id })
        .from(appSchema.project)
        .where(
          and(eq(appSchema.project.tenantId, tenantId), eq(appSchema.project.slug, args.project)),
        );
      const projectId = projects[0]?.id;
      if (!projectId) throw new Error(`project ${args.project} not found in tenant ${args.tenant}`);
      await tx
        .insert(appSchema.projectMembership)
        .values({
          tenantId,
          projectId,
          tenantMembershipId,
          role: args.projectRole,
          status: "active",
        })
        .onConflictDoUpdate({
          target: [
            appSchema.projectMembership.projectId,
            appSchema.projectMembership.tenantMembershipId,
          ],
          set: { role: args.projectRole, status: "active" },
        });
    }
  });

  console.log(
    `provisioned ${args.email} · tenant ${args.tenant} (${args.tenantRole})` +
      (args.project ? ` · project ${args.project} (${args.projectRole})` : ""),
  );
} finally {
  await runtimePool.end();
  await migratorPool.end();
}
