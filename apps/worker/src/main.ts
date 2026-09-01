import { createPool, type Pool } from "@eia/db";
import { InMemoryJobQueue } from "@eia/domain";
import pino from "pino";

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
      name: "database-pool",
      run: async () => {
        if (pool) await pool.end();
      },
    },
  ],
});

try {
  await worker.start();
} catch (error) {
  logger.error(
    { error: error instanceof Error ? error.message : String(error) },
    "worker failed to start",
  );
  if (pool) await (pool as Pool).end();
  process.exit(1);
}
