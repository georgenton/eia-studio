import { createClassifier, createMemoryStorage, createS3Storage } from "@eia/application";
import { createDatabase, createPool, type Pool } from "@eia/db";
import { InMemoryJobQueue } from "@eia/domain";
import pino from "pino";

import { ClassificationConsumer } from "./classification-consumer";
import { ExtractionConsumer } from "./extraction-consumer";
import { loadWorkerConfig } from "./config";
import { WorkerProcess } from "./process";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: ["*.password", "*.token", "*.secret", "*.email"], censor: "[redacted]" },
});

let config: ReturnType<typeof loadWorkerConfig>;
try {
  config = loadWorkerConfig();
} catch (error) {
  // Only variable names are in the message (EnvValidationError), never values.
  logger.error(
    { error: error instanceof Error ? error.message : String(error) },
    "invalid configuration",
  );
  process.exit(1);
}

let pool: Pool | null = null;
const poolsToClose: Pool[] = [];
const checks = [];
if (config.database) {
  const url = config.database.DATABASE_URL;
  checks.push({
    name: "database",
    run: async () => {
      pool = createPool(url, { max: 2, applicationName: "eia-studio-worker" });
      const result = await pool.query<{ role: string; bypass: boolean }>(
        "select current_user as role, (select rolbypassrls from pg_roles where rolname = current_user) as bypass",
      );
      const row = result.rows[0];
      if (!row || row.bypass) throw new Error("worker must run with an RLS-enforced role");
      logger.info({ role: row.role }, "database reachable with RLS-enforced role");
    },
  });
}

/**
 * The Social classification consumer (Slice 4), started only when this process can actually do the
 * work: it needs a database to poll, and an available classifier to call.
 *
 * **A worker with no usable classifier never claims** (IG4-001). Claiming and then failing would
 * consume the queue, mark classifications `FAILED` and leave a specialist looking at errors whose
 * cause is a missing environment variable. Not starting the consumer leaves the work where it is,
 * and the reason is one log line away.
 */
let consumer: ClassificationConsumer | null = null;
if (config.database && config.classifier.state === "AVAILABLE") {
  const available = config.classifier;
  const consumerPool = createPool(config.database.DATABASE_URL, {
    max: 4,
    applicationName: "eia-studio-worker-social",
  });
  consumer = new ClassificationConsumer({
    db: createDatabase(consumerPool),
    classifier: createClassifier(available),
    logger,
  });
  checks.push({
    name: "social-classifier",
    run: async () => {
      logger.info(
        { classifier: available.kind, model: available.model, live: available.live },
        "social classifier configured",
      );
    },
  });
  poolsToClose.push(consumerPool);
} else if (config.classifier.state === "UNAVAILABLE") {
  logger.warn(
    { reason: config.classifier.reason, detail: config.classifier.detail },
    "social classification disabled: this worker will not claim classification work",
  );
}

/**
 * The document extraction consumer (ADR-033), started only when this process can actually do the
 * work: a database to poll and a store to fetch from.
 *
 * The same rule as the classifier's, for the same reason. A worker with no usable storage never
 * claims: claiming and then failing at the first fetch would drain the queue and mark every
 * document `FAILED` over a missing environment variable, which is a much worse outcome than
 * documents that stay queued until somebody reads one log line.
 */
let extraction: ExtractionConsumer | null = null;
if (config.database && config.storage.state === "AVAILABLE") {
  const available = config.storage;
  const extractionPool = createPool(config.database.DATABASE_URL, {
    max: 2,
    applicationName: "eia-studio-worker-documents",
  });
  const storage =
    available.provider === "memory"
      ? createMemoryStorage()
      : createS3Storage({
          bucket: config.storageConfig.bucket!,
          region: config.storageConfig.region!,
          ...(config.storageConfig.endpoint === undefined
            ? {}
            : { endpoint: config.storageConfig.endpoint }),
          accessKeyId: config.storageConfig.accessKeyId!,
          secretAccessKey: config.storageConfig.secretAccessKey!,
        });
  extraction = new ExtractionConsumer({
    db: createDatabase(extractionPool),
    storage,
    logger,
  });
  checks.push({
    name: "document-storage",
    run: async () => {
      logger.info(
        { provider: available.provider, live: available.live },
        "document extraction configured",
      );
      /*
       * A memory store in the worker is an empty store: the bytes live in the web process that
       * received the upload. It is allowed only in `local` and `test`, where the two are usually
       * one process or nobody is uploading — and saying so here is better than a run of `FAILED`
       * documents whose cause is a topology nobody wrote down (TD-100).
       */
      if (available.provider === "memory") {
        logger.warn(
          {},
          "storage is the in-memory store: this worker cannot read files another process stored",
        );
      }
    },
  });
  poolsToClose.push(extractionPool);
} else if (config.storage.state === "UNAVAILABLE") {
  logger.warn(
    { reason: config.storage.reason, detail: config.storage.detail },
    "document extraction disabled: this worker will not claim extraction work",
  );
}

const worker = new WorkerProcess({
  logger,
  queue: new InMemoryJobQueue(),
  healthPort: config.worker.WORKER_HEALTH_PORT,
  heartbeatMs: config.worker.WORKER_HEARTBEAT_MS,
  shutdownTimeoutMs: config.worker.WORKER_SHUTDOWN_TIMEOUT_MS,
  version: process.env.npm_package_version ?? "0.0.0",
  checks,
  onStop: [
    {
      name: "social-consumer",
      run: async () => {
        if (consumer) await consumer.stop();
      },
    },
    {
      name: "extraction-consumer",
      run: async () => {
        if (extraction) await extraction.stop();
      },
    },
    {
      name: "database-pool",
      run: async () => {
        if (pool) await pool.end();
        for (const open of poolsToClose) await open.end();
      },
    },
  ],
});

try {
  await worker.start();
  consumer?.start();
  extraction?.start();
} catch (error) {
  logger.error(
    { error: error instanceof Error ? error.message : String(error) },
    "worker failed to start",
  );
  if (pool) await (pool as Pool).end();
  process.exit(1);
}
