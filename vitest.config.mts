import { defineConfig } from "vitest/config";

// Test hierarchy (TESTING_STRATEGY.md): unit + domain run without infrastructure;
// integration (database, RLS, cross-tenant harness, migrations) needs Docker via Testcontainers.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "**/node_modules/**", "**/.next/**"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["packages/**/*.integration.test.ts", "apps/**/*.integration.test.ts"],
          exclude: ["**/node_modules/**"],
          environment: "node",
          globalSetup: ["./packages/testing/src/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 240_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
