import { createClassifier } from "@eia/application";
import { createDatabase, createPool, type Pool } from "@eia/db";
import { InMemoryJobQueue } from "@eia/domain";
import pino from "pino";

import { ClassificationConsumer } from "./classification-consumer";
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
 * The Social classification consumer (Slice 4). It starts only when this process has a database
 * connection: without one there is no queue to poll. The classifier is chosen by explicit
 * configuration and never falls back — `createClassifier` throws when the gateway is configured
 * without a key, because inventing codings would be worse than refusing to start.
 */
let consumer: ClassificationConsumer | null = null;
if (config.database) {
  const consumerPool = createPool(config.database.DATABASE_URL, {
    max: 4,
    applicationName: "eia-studio-worker-social",
  });
  consumer = new ClassificationConsumer({
    db: createDatabase(consumerPool),
    classifier: createClassifier({
      kind: config.social.SOCIAL_CLASSIFIER,
      gatewayApiKeyPresent: config.social.AI_GATEWAY_API_KEY !== undefined,
    }),
    logger,
  });
  checks.push({
    name: "social-classifier",
    run: async () => {
      logger.info(
        {
          classifier: config.social.SOCIAL_CLASSIFIER,
          model: config.social.SOCIAL_CLASSIFIER_MODEL,
        },
        "social classifier configured",
      );
    },
  });
  poolsToClose.push(consumerPool);
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
} catch (error) {
  logger.error(
    { error: error instanceof Error ? error.message : String(error) },
    "worker failed to start",
  );
  if (pool) await (pool as Pool).end();
  process.exit(1);
}
