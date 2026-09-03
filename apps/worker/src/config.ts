import {
  appEnvSchema,
  loadEnv,
  runtimeDatabaseEnvSchema,
  socialEnvSchema,
  workerEnvSchema,
  type AppEnv,
  type EnvSource,
  type RuntimeDatabaseEnv,
  type SocialEnv,
  type WorkerEnv,
} from "@eia/contracts";

export interface WorkerConfig {
  readonly app: AppEnv;
  readonly database: RuntimeDatabaseEnv | null;
  readonly worker: WorkerEnv;
  /** Which classifier this process runs, and which model it asks for (Slice 4 §48). */
  readonly social: SocialEnv;
}

/** Validated at startup; the process refuses to start with invalid configuration. */
export function loadWorkerConfig(source: EnvSource = process.env): WorkerConfig {
  const app = loadEnv("app", appEnvSchema, source);
  const worker = loadEnv("worker", workerEnvSchema, source);
  const database = worker.WORKER_DB_CHECK
    ? loadEnv("database", runtimeDatabaseEnvSchema, source)
    : null;
  const social = loadEnv("social", socialEnvSchema, source);
  return { app, worker, database, social };
}
