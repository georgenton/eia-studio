import "server-only";

import {
  appEnvSchema,
  authEnvSchema,
  emailEnvSchema,
  loadEnv,
  runtimeDatabaseEnvSchema,
  socialEnvSchema,
  type AppEnv,
  type AuthEnv,
  type EmailEnv,
  type RuntimeDatabaseEnv,
  type SocialEnv,
} from "@eia/contracts";

interface WebEnv {
  readonly app: AppEnv;
  readonly database: RuntimeDatabaseEnv;
  readonly auth: AuthEnv;
  readonly email: EmailEnv;
  /** Which classifier a run is created for, and which model it asks for (Slice 4). */
  readonly social: SocialEnv;
}

let cached: WebEnv | null = null;

/**
 * Preview deployments get their origin from the platform, not from configuration: Vercel assigns
 * a per-branch/per-deployment hostname that cannot be known in advance. When `PUBLIC_APP_URL` or
 * `BETTER_AUTH_URL` are not set explicitly, they are derived from Vercel's own variables so that
 * Better Auth's base URL matches the origin actually serving the request. Explicit values always
 * win, which is how staging and production are pinned to their real hostnames.
 */
function withPlatformDefaults(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const host = source.VERCEL_BRANCH_URL ?? source.VERCEL_URL;
  if (!host) return source;
  const origin = `https://${host}`;
  return {
    ...source,
    PUBLIC_APP_URL: source.PUBLIC_APP_URL ?? origin,
    BETTER_AUTH_URL: source.BETTER_AUTH_URL ?? origin,
  };
}

/** Validated lazily at first use so `next build` does not require runtime secrets. */
export function getEnv(): WebEnv {
  if (cached) return cached;
  const source = withPlatformDefaults(process.env);
  cached = {
    app: loadEnv("app", appEnvSchema, source),
    database: loadEnv("database", runtimeDatabaseEnvSchema, source),
    auth: loadEnv("auth", authEnvSchema, source),
    email: loadEnv("email", emailEnvSchema, source),
    social: loadEnv("social", socialEnvSchema, source),
  };
  return cached;
}
