import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { appEnvSchema, loadEnv, migratorDatabaseEnvSchema } from "@eia/contracts";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createDatabase, createPool } from "../src/client";
import { appSchema } from "../src/schema/index";
import { loadDotenv } from "./env";

/**
 * Development seed: loads the synthetic, PII-free demo tenant fixture and optionally makes an
 * existing user its OWNER (`--user-email you@example.test`). Uses the migrator connection
 * (fixtures are imported by tooling, never by application requests). Refuses to run outside
 * local/test/preview or when DEMO_FIXTURES_ENABLED is false.
 */
loadDotenv();
const app = loadEnv("app", appEnvSchema);
// Staging is allowed: it is a synthetic environment by construction (docs/DEPLOYMENT.md §4a).
// Production never is, and `DEMO_FIXTURES_ENABLED` must be set deliberately either way.
if (!app.DEMO_FIXTURES_ENABLED || app.APP_ENV === "production") {
  console.error(
    "seed:dev refused: DEMO_FIXTURES_ENABLED must be true and APP_ENV must not be production",
  );
  process.exit(1);
}
const env = loadEnv("migrator", migratorDatabaseEnvSchema);

const manifestSchema = z
  .object({
    $comment: z.string().optional(),
    slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
    name: z.string().min(1),
    regime: z.literal("DEMO_SIMULATION"),
    capabilities: z.object({ entitled: z.array(z.string()), enabled: z.array(z.string()) }),
  })
  .strict();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const manifestPath = resolve(root, "fixtures/tenants/demo-consultancy/manifest.json");
const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));

const emailArgIndex = process.argv.indexOf("--user-email");
const userEmail = emailArgIndex >= 0 ? process.argv[emailArgIndex + 1] : undefined;

const pool = createPool(env.DATABASE_MIGRATOR_URL, { max: 1, applicationName: "eia-studio-seed" });
const db = createDatabase(pool);
try {
  await db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(appSchema.tenant)
      .values({ slug: manifest.slug, name: manifest.name })
      .onConflictDoUpdate({ target: appSchema.tenant.slug, set: { name: manifest.name } })
      .returning({ id: appSchema.tenant.id });
    const tenantId = tenant!.id;
    for (const key of manifest.capabilities.entitled) {
      await tx
        .insert(appSchema.tenantCapability)
        .values({
          tenantId,
          capabilityKey: key,
          entitled: true,
          enabled: manifest.capabilities.enabled.includes(key),
        })
        .onConflictDoUpdate({
          target: [appSchema.tenantCapability.tenantId, appSchema.tenantCapability.capabilityKey],
          set: {
            entitled: true,
            enabled: manifest.capabilities.enabled.includes(key),
            changedAt: sql`now()`,
          },
        });
    }
    if (userEmail) {
      const [user] = await tx
        .select({ id: appSchema.user.id })
        .from(appSchema.user)
        .where(eq(appSchema.user.email, userEmail));
      if (!user) throw new Error("user not found; sign up in the web app first");
      await tx
        .insert(appSchema.tenantMembership)
        .values({ tenantId, userId: user.id, role: "OWNER", status: "active" })
        .onConflictDoNothing();
      console.log(`membership OWNER ensured for ${userEmail}`);
    }
    console.log(
      `demo tenant "${manifest.slug}" seeded (${manifest.capabilities.entitled.length} capabilities)`,
    );
  });
} finally {
  await pool.end();
}
