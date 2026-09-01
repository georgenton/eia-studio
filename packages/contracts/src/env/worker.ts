import { z } from "zod";

import { booleanString, integerString } from "./common";

/** Persistent worker process (ADR-012; ARCHITECTURE.md §6). */
export const workerEnvSchema = z
  .object({
    WORKER_HEALTH_PORT: integerString.default(3100).pipe(z.number().int().min(0).max(65535)),
    WORKER_HEARTBEAT_MS: integerString.default(15_000).pipe(z.number().int().min(100)),
    WORKER_SHUTDOWN_TIMEOUT_MS: integerString.default(10_000).pipe(z.number().int().min(100)),
    WORKER_DB_CHECK: booleanString.default(true),
  })
  .strict();

export type WorkerEnv = z.infer<typeof workerEnvSchema>;
