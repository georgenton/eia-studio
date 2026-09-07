import { defineConfig, devices } from "@playwright/test";

/**
 * The live-provider validation run, kept deliberately outside the ordinary suite.
 *
 * `pnpm e2e` uses `playwright.config.ts` and cannot reach this file, so CI can never make a
 * billable request to a tile provider. This one is run by hand, by somebody who has the key, to
 * look at the real imagery and produce the screenshots:
 *
 *   MAPTILER_KEY=… DEMO_USER_PASSWORD=… npx playwright test --config playwright.live.config.ts
 *
 * It reuses the coordinator session the ordinary setup project writes, so run `pnpm e2e` (or the
 * setup project) at least once first.
 */
const PORT = Number(process.env.E2E_LIVE_PORT ?? 3102);
const baseURL = `http://127.0.0.1:${PORT}`;

if (!process.env.MAPTILER_KEY) {
  throw new Error(
    "playwright.live.config.ts: MAPTILER_KEY must be set; this run uses the real provider",
  );
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: /(^|\/)basemap-live\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    locale: "es-EC",
    timezoneId: "UTC",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 940 },
    storageState: "e2e/.auth/coordinator.json",
    trace: "off",
  },
  webServer: {
    command: `pnpm --filter @eia/web start --port ${PORT}`,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      APP_ENV: "test",
      PUBLIC_APP_URL: baseURL,
      BETTER_AUTH_URL: baseURL,
      AUTH_TRUSTED_ORIGINS: baseURL,
      SOCIAL_CLASSIFIER: "fake",
      SOCIAL_CLASSIFIER_MODEL: "fake/deterministic",
      BASEMAP_PROVIDER: "maptiler",
      // From the operator's environment; never written to a file in this repository.
      MAPTILER_KEY: process.env.MAPTILER_KEY,
    },
  },
});
