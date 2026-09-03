import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase, createPool, provisionRuntimeRole, runMigrations } from "@eia/db";
import { GenericContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";

import { stampEphemeralTestDatabase } from "./ephemeral-guard";

/**
 * Vitest global setup for the `integration` project: builds the PostGIS + pgvector image from
 * docker/postgres (cached by Docker), starts one container, applies migrations with the
 * superuser (migrator), provisions a runtime login role with a random password, and stamps the
 * database as ephemeral. Connection URLs reach tests through `inject("eiaTestDatabase")`.
 *
 * **This suite runs against a throwaway container and nothing else** (IG3-001). It used to accept
 * `EIA_TEST_MIGRATOR_URL` / `EIA_TEST_RUNTIME_URL` and run against an already-provisioned
 * database, which is how a destructive suite came to be pointed at persistent staging and removed
 * the synthetic identities the demo campaign depends on. That escape hatch is gone: verifying a
 * real provider is now the job of the non-destructive staging suite (`pnpm test:staging`), which
 * reads a persistent environment without resetting it.
 */
export interface EiaTestDatabase {
  readonly migratorUrl: string;
  readonly runtimeUrl: string;
  readonly runtimeRole: string;
  /**
   * Proof that this database is the throwaway one created below. Destructive helpers verify it
   * against the marker row before touching anything (`assertEphemeralTestDatabase`).
   */
  readonly ephemeralToken: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    eiaTestDatabase: EiaTestDatabase;
  }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const IMAGE = "eia-studio/postgres-test:17-3.5-pgvector";

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // A leftover pointer to a real database is a mistake worth naming, not ignoring: the variables
  // no longer do anything, and silently starting a container instead would leave the operator
  // believing they had verified the provider.
  for (const stale of ["EIA_TEST_MIGRATOR_URL", "EIA_TEST_RUNTIME_URL"]) {
    if (process.env[stale]) {
      throw new Error(
        `${stale} is set, but the integration suite no longer runs against an external database ` +
          `(IG3-001): it truncates tenants and identities and would destroy a persistent ` +
          `environment. Unset it, and use pnpm test:staging to verify a real provider.`,
      );
    }
  }

  const built = await GenericContainer.fromDockerfile(resolve(ROOT, "docker/postgres")).build(
    IMAGE,
    {
      deleteOnExit: false,
    },
  );
  const container = await built
    .withEnvironment({
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: "postgres",
      POSTGRES_DB: "eia_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(180_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const migratorUrl = `postgres://postgres:postgres@${host}:${port}/eia_test`;
  const runtimeRole = "eia_app_login";
  const password = randomBytes(24).toString("hex");
  const runtimeUrl = `postgres://${runtimeRole}:${password}@${host}:${port}/eia_test`;

  await runMigrations(migratorUrl);
  await provisionRuntimeRole(migratorUrl, { name: runtimeRole, password });

  // Stamp it, with a token generated in this process and never written down anywhere else, so the
  // destructive helpers can prove what they are connected to.
  const ephemeralToken = randomBytes(24).toString("hex");
  const stampPool = createPool(migratorUrl, { max: 1, applicationName: "eia-test-stamp" });
  try {
    await stampEphemeralTestDatabase(createDatabase(stampPool), ephemeralToken);
  } finally {
    await stampPool.end();
  }

  project.provide("eiaTestDatabase", { migratorUrl, runtimeUrl, runtimeRole, ephemeralToken });

  return async () => {
    await container.stop();
  };
}
