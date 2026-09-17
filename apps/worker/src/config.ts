import {
  appEnvSchema,
  loadEnv,
  runtimeDatabaseEnvSchema,
  documentReviewerEnvSchema,
  socialEnvSchema,
  storageEnvSchema,
  workerEnvSchema,
  type AppEnv,
  type EnvSource,
  type RuntimeDatabaseEnv,
  type WorkerEnv,
} from "@eia/contracts";
import {
  resolveClassifierAvailability,
  resolveDocumentReviewerAvailability,
  resolveStorageAvailability,
  type ClassifierAvailability,
  type StorageAvailability,
} from "@eia/domain";

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
  /**
   * Whether this process can read an uploaded file at all (ADR-031, ADR-033). `UNAVAILABLE` is not
   * a startup failure either: the worker runs and simply never claims extraction work, because a
   * worker that claimed and then failed at the first fetch would consume the queue and mark every
   * document `FAILED` over a missing environment variable.
   */
  readonly storage: StorageAvailability;
  /**
   * Whether this process may run AI document review (ADR-035). Same rule again: `UNAVAILABLE` is
   * not a startup failure, and a worker that cannot review never claims a review.
   */
  readonly reviewer: ClassifierAvailability;
  /** What was configured, for the adapter to build from. `getStorage` reads `storage` first. */
  readonly storageConfig: {
    readonly bucket: string | undefined;
    readonly region: string | undefined;
    readonly endpoint: string | undefined;
    readonly accessKeyId: string | undefined;
    readonly secretAccessKey: string | undefined;
  };
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
  const reviewerEnv = loadEnv("documentReviewer", documentReviewerEnvSchema, source);
  const reviewer = resolveDocumentReviewerAvailability({
    appEnv: app.APP_ENV,
    reviewer: reviewerEnv.DOCUMENT_REVIEWER,
    model: reviewerEnv.DOCUMENT_REVIEWER_MODEL,
    gatewayApiKeyPresent: reviewerEnv.AI_GATEWAY_API_KEY !== undefined,
  });
  const storageEnv = loadEnv("storage", storageEnvSchema, source);
  const storage = resolveStorageAvailability({
    appEnv: app.APP_ENV,
    provider: storageEnv.STORAGE_PROVIDER,
    bucket: storageEnv.STORAGE_BUCKET,
    region: storageEnv.STORAGE_REGION,
    endpoint: storageEnv.STORAGE_ENDPOINT,
    credentialsPresent:
      storageEnv.STORAGE_ACCESS_KEY_ID !== undefined &&
      storageEnv.STORAGE_SECRET_ACCESS_KEY !== undefined,
  });
  return {
    app,
    worker,
    database,
    classifier,
    reviewer,
    storage,
    storageConfig: {
      bucket: storageEnv.STORAGE_BUCKET,
      region: storageEnv.STORAGE_REGION,
      endpoint: storageEnv.STORAGE_ENDPOINT,
      accessKeyId: storageEnv.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: storageEnv.STORAGE_SECRET_ACCESS_KEY,
    },
  };
}
