import {
  appEnvSchema,
  loadEnv,
  runtimeDatabaseEnvSchema,
  workerEnvSchema,
  type AppEnv,
  type EnvSource,
  type RuntimeDatabaseEnv,
  type WorkerEnv,
} from "@eia/contracts";

export interface WorkerConfig {
  readonly app: AppEnv;
  readonly database: RuntimeDatabaseEnv | null;
  readonly worker: WorkerEnv;
}

/** Validated at startup; the process refuses to start with invalid configuration. */
export function loadWorkerConfig(source: EnvSource = process.env): WorkerConfig {
  const app = loadEnv("app", appEnvSchema, source);
  const worker = loadEnv("worker", workerEnvSchema, source);
  const database = worker.WORKER_DB_CHECK
    ? loadEnv("database", runtimeDatabaseEnvSchema, source)
    : null;
  return { app, worker, database };
}
