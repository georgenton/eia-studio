import "server-only";

import {
  appEnvSchema,
  authEnvSchema,
  emailEnvSchema,
  loadEnv,
  runtimeDatabaseEnvSchema,
  type AppEnv,
  type AuthEnv,
  type EmailEnv,
  type RuntimeDatabaseEnv,
} from "@eia/contracts";

interface WebEnv {
  readonly app: AppEnv;
  readonly database: RuntimeDatabaseEnv;
  readonly auth: AuthEnv;
  readonly email: EmailEnv;
}

let cached: WebEnv | null = null;

/** Validated lazily at first use so `next build` does not require runtime secrets. */
export function getEnv(): WebEnv {
  if (cached) return cached;
  cached = {
    app: loadEnv("app", appEnvSchema),
    database: loadEnv("database", runtimeDatabaseEnvSchema),
    auth: loadEnv("auth", authEnvSchema),
    email: loadEnv("email", emailEnvSchema),
  };
  return cached;
}
