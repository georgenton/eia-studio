import { z } from "zod";

import { postgresUrl } from "./common";

/** Runtime connection: RLS-enforced application role (ADR-004). Used by web and worker. */
export const runtimeDatabaseEnvSchema = z
  .object({
    DATABASE_URL: postgresUrl,
  })
  .strict();

/** Migrator connection: schema owner; used only by migrations and provisioning scripts. */
export const migratorDatabaseEnvSchema = z
  .object({
    DATABASE_MIGRATOR_URL: postgresUrl,
  })
  .strict();

/** Runtime login role provisioning (name + password come from the environment, never SQL). */
export const runtimeRoleProvisioningEnvSchema = z
  .object({
    DATABASE_MIGRATOR_URL: postgresUrl,
    DATABASE_APP_ROLE_NAME: z
      .string()
      .regex(/^[a-z_][a-z0-9_]{2,62}$/, "must be a simple lowercase PostgreSQL identifier"),
    DATABASE_APP_ROLE_PASSWORD: z.string().min(16, "must be at least 16 characters"),
  })
  .strict();

export type RuntimeDatabaseEnv = z.infer<typeof runtimeDatabaseEnvSchema>;
export type MigratorDatabaseEnv = z.infer<typeof migratorDatabaseEnvSchema>;
export type RuntimeRoleProvisioningEnv = z.infer<typeof runtimeRoleProvisioningEnvSchema>;
