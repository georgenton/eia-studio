import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { provisionRuntimeRole, runMigrations } from "@eia/db";
import { GenericContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";

/**
 * Vitest global setup for the `integration` project: builds the PostGIS + pgvector image from
 * docker/postgres (cached by Docker), starts one container, applies migrations with the
 * superuser (migrator) and provisions a runtime login role with a random password.
 * Connection URLs reach tests through `inject("eiaTestDatabase")`.
 */
export interface EiaTestDatabase {
  readonly migratorUrl: string;
  readonly runtimeUrl: string;
  readonly runtimeRole: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    eiaTestDatabase: EiaTestDatabase;
  }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const IMAGE = "eia-studio/postgres-test:17-3.5-pgvector";

/**
 * Staging/external mode (Slice 0.5): when EIA_TEST_MIGRATOR_URL and EIA_TEST_RUNTIME_URL are set,
 * the suite runs against an already-provisioned database instead of Testcontainers. Used to prove
 * the isolation guarantees on a real provider (docs/STAGING_GATE_0_5.md). The suite truncates
 * tables, so it may only be pointed at a database holding synthetic data.
 */
function externalDatabase(): EiaTestDatabase | null {
  const migratorUrl = process.env.EIA_TEST_MIGRATOR_URL;
  const runtimeUrl = process.env.EIA_TEST_RUNTIME_URL;
  if (!migratorUrl || !runtimeUrl) return null;
  const runtimeRole = decodeURIComponent(new URL(runtimeUrl).username);
  return { migratorUrl, runtimeUrl, runtimeRole };
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = externalDatabase();
  if (external) {
    await runMigrations(external.migratorUrl);
    project.provide("eiaTestDatabase", external);
    return async () => {};
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

  project.provide("eiaTestDatabase", { migratorUrl, runtimeUrl, runtimeRole });

  return async () => {
    await container.stop();
  };
}
