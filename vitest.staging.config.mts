import { defineConfig } from "vitest/config";

/**
 * The non-destructive verification of a persistent environment (`pnpm test:staging`, IG3-001).
 *
 * A separate config file rather than a third project in `vitest.config.mts`, on purpose: the
 * default `pnpm test` runs every project it finds, and a staging suite that could be started by
 * accident — or a staging global-setup that runs whenever someone types `pnpm test` — is the same
 * class of mistake this condition is about. Reaching this environment takes an explicit command
 * and two explicit environment variables.
 *
 * Nothing here starts a container, applies a migration, seeds or truncates. See
 * `packages/testing/src/staging-setup.ts`.
 */
export default defineConfig({
  test: {
    name: "staging",
    include: ["packages/testing/test/staging/**/*.staging.test.ts"],
    exclude: ["**/node_modules/**"],
    environment: "node",
    globalSetup: ["./packages/testing/src/staging-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One connection pool at a time against a shared environment, and a deterministic order.
    fileParallelism: false,
  },
});
