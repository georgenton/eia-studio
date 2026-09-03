import {
  appEnvSchema,
  loadEnv,
  runtimeDatabaseEnvSchema,
  socialEnvSchema,
  workerEnvSchema,
  type AppEnv,
  type EnvSource,
  type RuntimeDatabaseEnv,
  type WorkerEnv,
} from "@eia/contracts";
import { resolveClassifierAvailability, type ClassifierAvailability } from "@eia/domain";

export interface WorkerConfig {
  readonly app: AppEnv;
  readonly database: RuntimeDatabaseEnv | null;
  readonly worker: WorkerEnv;
  /**
   * Whether this process may run assisted coding at all, resolved once from `APP_ENV` and the
   * social variables (IG4-001). `UNAVAILABLE` is not a startup failure: the worker still runs, it
   * simply never claims classification work.
   */
  readonly classifier: ClassifierAvailability;
}

/** Validated at startup; the process refuses to start with invalid configuration. */
export function loadWorkerConfig(source: EnvSource = process.env): WorkerConfig {
  const app = loadEnv("app", appEnvSchema, source);
  const worker = loadEnv("worker", workerEnvSchema, source);
  const database = worker.WORKER_DB_CHECK
    ? loadEnv("database", runtimeDatabaseEnvSchema, source)
    : null;
  const social = loadEnv("social", socialEnvSchema, source);
  const classifier = resolveClassifierAvailability({
    appEnv: app.APP_ENV,
    classifier: social.SOCIAL_CLASSIFIER,
    model: social.SOCIAL_CLASSIFIER_MODEL,
    gatewayApiKeyPresent: social.AI_GATEWAY_API_KEY !== undefined,
  });
  return { app, worker, database, classifier };
}
