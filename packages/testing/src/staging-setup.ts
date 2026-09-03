import type { TestProject } from "vitest/node";

/**
 * Vitest global setup for the `staging` project: the **non-destructive** verification of a
 * persistent environment (IG3-001).
 *
 * What it deliberately does not do: it does not start a container, does not apply migrations, does
 * not seed, does not truncate and does not reset. Applying migrations to staging is an operator
 * action (`pnpm db:migrate`); this suite's job is to *observe* what is installed there and to read
 * the demo fixture through the runtime role, leaving the environment exactly as it found it.
 *
 * It takes its own environment variables rather than reusing the integration suite's, so that a
 * pointer at a real database can never be mistaken for a pointer at a throwaway one.
 */
export interface EiaStagingDatabase {
  readonly migratorUrl: string;
  readonly runtimeUrl: string;
  readonly runtimeRole: string;
  readonly label: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    eiaStagingDatabase: EiaStagingDatabase;
  }
}

export default async function setup(project: TestProject): Promise<void> {
  const migratorUrl = process.env.EIA_STAGING_MIGRATOR_URL;
  const runtimeUrl = process.env.EIA_STAGING_RUNTIME_URL;
  if (!migratorUrl || !runtimeUrl) {
    throw new Error(
      "pnpm test:staging needs EIA_STAGING_MIGRATOR_URL and EIA_STAGING_RUNTIME_URL. Both point " +
        "at the persistent environment to verify; the suite only reads it.",
    );
  }

  const runtime = new URL(runtimeUrl);
  const migrator = new URL(migratorUrl);
  if (runtime.host !== migrator.host || runtime.pathname !== migrator.pathname) {
    throw new Error(
      "the staging migrator and runtime URLs must address the same database; verifying one " +
        "environment's schema against another's data proves nothing",
    );
  }

  project.provide("eiaStagingDatabase", {
    migratorUrl,
    runtimeUrl,
    runtimeRole: decodeURIComponent(runtime.username),
    // Host and database name only: never the credential, and never printed by a passing test.
    label: `${runtime.hostname}${runtime.pathname}`,
  });
}
