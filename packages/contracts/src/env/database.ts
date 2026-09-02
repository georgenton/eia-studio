import { z } from "zod";

import { APP_ENVIRONMENTS } from "./app";
import { postgresUrl } from "./common";

/**
 * `sslmode` values that authenticate the server, not merely encrypt the channel. `require`
 * encrypts but accepts any certificate, and `no-verify` says so explicitly, so both leave the
 * connection open to an impersonated database endpoint.
 */
const VERIFYING_SSL_MODES = new Set(["verify-ca", "verify-full"]);

const PRODUCTION_TLS_MESSAGE =
  "must request server identity verification in production: add sslmode=verify-full " +
  "(or sslmode=verify-ca) to the connection URL";

/** Reads `sslmode` without ever surfacing the URL; an unparseable URL counts as unverified. */
function verifiesServerIdentity(url: string): boolean {
  try {
    const mode = new URL(url).searchParams.get("sslmode");
    return mode !== null && VERIFYING_SSL_MODES.has(mode.trim().toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Refuses an unverified database TLS mode when `APP_ENV=production` (SECURITY.md §5,
 * docs/TECH_DEBT.md TD-016). Non-production environments are unaffected: staging connects to a
 * database presenting a self-signed certificate and legitimately uses `sslmode=no-verify`, and
 * local development connects over a loopback container. The check reads only the `sslmode`
 * query parameter and reports the variable name, never its value.
 */
function requireVerifiedTlsInProduction<K extends string>(key: K) {
  return {
    check: (value: { APP_ENV: string } & Record<K, string>): boolean =>
      value.APP_ENV !== "production" || verifiesServerIdentity(value[key]),
    options: { message: PRODUCTION_TLS_MESSAGE, path: [key] as [K] },
  };
}

/** `APP_ENV` is read (not owned) here so the production TLS rule can be expressed on one object. */
const appEnvForTlsRule = z.enum(APP_ENVIRONMENTS).default("local");

const runtimeTls = requireVerifiedTlsInProduction("DATABASE_URL");
const migratorTls = requireVerifiedTlsInProduction("DATABASE_MIGRATOR_URL");

/** Runtime connection: RLS-enforced application role (ADR-004). Used by web and worker. */
export const runtimeDatabaseEnvSchema = z
  .object({
    APP_ENV: appEnvForTlsRule,
    DATABASE_URL: postgresUrl,
  })
  .strict()
  .refine(runtimeTls.check, runtimeTls.options);

/** Migrator connection: schema owner; used only by migrations and provisioning scripts. */
export const migratorDatabaseEnvSchema = z
  .object({
    APP_ENV: appEnvForTlsRule,
    DATABASE_MIGRATOR_URL: postgresUrl,
  })
  .strict()
  .refine(migratorTls.check, migratorTls.options);

/** Runtime login role provisioning (name + password come from the environment, never SQL). */
export const runtimeRoleProvisioningEnvSchema = z
  .object({
    APP_ENV: appEnvForTlsRule,
    DATABASE_MIGRATOR_URL: postgresUrl,
    DATABASE_APP_ROLE_NAME: z
      .string()
      .regex(/^[a-z_][a-z0-9_]{2,62}$/, "must be a simple lowercase PostgreSQL identifier"),
    DATABASE_APP_ROLE_PASSWORD: z.string().min(16, "must be at least 16 characters"),
  })
  .strict()
  .refine(migratorTls.check, migratorTls.options);

export type RuntimeDatabaseEnv = z.infer<typeof runtimeDatabaseEnvSchema>;
export type MigratorDatabaseEnv = z.infer<typeof migratorDatabaseEnvSchema>;
export type RuntimeRoleProvisioningEnv = z.infer<typeof runtimeRoleProvisioningEnvSchema>;
