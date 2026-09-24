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
/**
 * A throwaway S3-compatible store, beside the throwaway database.
 *
 * MinIO speaks the S3 protocol the production adapter speaks, so the integration suite exercises
 * the **real** adapter — presigned PUT, HEAD, GET — rather than a memory stand-in that would agree
 * with itself. Nothing billable is reached: the container lives for the run and dies with it
 * (PART E1 of the wave brief).
 */
export interface EiaTestStorage {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

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
    eiaTestStorage: EiaTestStorage;
  }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const IMAGE = "eia-studio/postgres-test:17-3.5-pgvector";
/**
 * The test object store, pinned **by digest** to a registry that still serves anonymous pulls.
 *
 * It used to be `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z`. On 24 September 2026 that
 * stopped being pullable without credentials — quay.io answers `401 UNAUTHORIZED` and Docker Hub's
 * `minio/minio` answers `pull access denied … repository does not exist`. This suite failed at
 * global setup with `(HTTP code 500) unauthorized`, which surfaces as *"No test files found"*
 * because setup dies before a file is collected; the e2e job failed on the same image a minute
 * later. Every developer machine kept passing on a cached layer, which is the worst shape a supply
 * change can take: green locally, red for everyone who starts clean.
 *
 * A digest rather than a tag, for the reason the previous pin existed: a store that changed under
 * us would be a flaky suite, and a moving `:latest` is not a pin.
 */
const MINIO_IMAGE =
  "chainguard/minio@sha256:bd014394a80898e68c149f2311fdf8d5a2c2f3bb2c33b9327ae6d02b4b065ae1";

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

  // The object store. Credentials are generated per run and exist only in this process's memory
  // and the container's: nothing about this store outlives the suite.
  const accessKeyId = randomBytes(12).toString("hex");
  const secretAccessKey = randomBytes(24).toString("hex");
  const bucket = "eia-test";
  const minio = await new GenericContainer(MINIO_IMAGE)
    .withEnvironment({ MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey })
    .withCommand(["server", "/data"])
    .withExposedPorts(9000)
    /*
     * Ready means *answering*, not *having printed a line*.
     *
     * This waited on `/API:/` in the log, which upstream MinIO prints and this image does not —
     * it prints `WebUI:` — so the first run after the image changed timed out at startup rather
     * than failing with anything that named the cause. The health endpoint is what the suite
     * actually needs to be true, and it does not depend on how a build formats its banner.
     */
    .withWaitStrategy(Wait.forHttp("/minio/health/live", 9000).forStatusCode(200))
    .withStartupTimeout(120_000)
    .start();
  const storageEndpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  await createBucket({ endpoint: storageEndpoint, bucket, accessKeyId, secretAccessKey });

  project.provide("eiaTestStorage", {
    endpoint: storageEndpoint,
    region: "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
  });

  return async () => {
    await Promise.all([container.stop(), minio.stop()]);
  };
}

/**
 * Create the bucket, with the SDK rather than the `mc` client.
 *
 * One fewer binary in the image, and it proves the credentials work against the same protocol the
 * adapter will use — if this call fails the suite says so here rather than in the first test.
 */
async function createBucket(config: {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<void> {
  const { CreateBucketCommand, S3Client } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: "us-east-1",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
}
