#!/usr/bin/env node
// A MinIO the e2e stack and the worker can both reach (ADR-034).
//
// Until now the Playwright suite ran `STORAGE_PROVIDER=memory`, which is per process: the web
// server held bytes no worker could see, so the pipeline could only be proved in pieces (TD-100).
// This starts one real S3-compatible store, writes its configuration where both the Playwright
// config and the test process can read it, and leaves it running.
//
// Plain `docker run` rather than Testcontainers, deliberately: this container must outlive the
// process that created it — the Playwright web server, the browser and the worker drain all use
// it — and Testcontainers' whole value is tying a container's life to a test run.
//
// `quay.io/minio/minio` is MinIO's own registry: Docker Hub's anonymous pull limits fail a CI run
// for reasons that have nothing to do with the change (ADR-031 §7).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const IMAGE = "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z";
const NAME = "eia-e2e-storage";
const PORT = Number(process.env.EIA_E2E_STORAGE_PORT ?? 9400);
const ACCESS_KEY = "eia-e2e-access";
const SECRET_KEY = "eia-e2e-secret-key";
const BUCKET = "eia-e2e";
export const CONFIG_PATH = process.env.EIA_E2E_STORAGE_CONFIG ?? "/tmp/eia-e2e-storage.json";

const docker = (args, options = {}) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: "pipe", ...options });

function running() {
  try {
    return docker(["inspect", "-f", "{{.State.Running}}", NAME]).trim() === "true";
  } catch {
    return false;
  }
}

function start() {
  try {
    docker(["rm", "-f", NAME]);
  } catch {
    // Not there; nothing to remove.
  }
  docker([
    "run",
    "-d",
    "--name",
    NAME,
    "-p",
    `${PORT}:9000`,
    "-e",
    `MINIO_ROOT_USER=${ACCESS_KEY}`,
    "-e",
    `MINIO_ROOT_PASSWORD=${SECRET_KEY}`,
    IMAGE,
    "server",
    "/data",
  ]);
}

async function waitForReady() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/minio/health/live`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("e2e storage did not become ready within 60s");
}

/** The bucket, created with the S3 API so this script needs no MinIO client binary. */
async function createBucket() {
  // Resolved from the workspace that actually depends on it: the repository root has no AWS SDK,
  // and adding one so a script could create a bucket would be a root dependency for a test fixture.
  const require = createRequire(
    new URL("../../packages/application/package.json", import.meta.url),
  );
  const { S3Client, CreateBucketCommand } = await import(
    pathToFileURL(require.resolve("@aws-sdk/client-s3")).href
  );
  const client = new S3Client({
    region: "us-east-1",
    endpoint: `http://127.0.0.1:${PORT}`,
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw error;
  }
}

export function storageConfig() {
  return {
    endpoint: `http://127.0.0.1:${PORT}`,
    region: "us-east-1",
    bucket: BUCKET,
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!running()) start();
  await waitForReady();
  await createBucket();
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(storageConfig(), null, 2)}\n`);
  console.log(`e2e storage ready on ${storageConfig().endpoint} (bucket ${BUCKET})`);
}
