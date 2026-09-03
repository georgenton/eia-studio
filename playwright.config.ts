import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite for the Slice 1 reviewer journey (TESTING_STRATEGY.md §1).
 *
 * Deliberately small: one journey through sign-in → Portfolio → Command Center → provenance,
 * plus the authorization denials that must hold in a real browser. Broad UI assertions belong in
 * unit and integration tests; brittle selector-heavy tests are not added here.
 *
 * The suite expects a database that has been migrated and seeded with the demo fixture and the
 * synthetic identities (`pnpm e2e:prepare`). It never creates accounts itself, because public
 * self-signup is disabled.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: "es-EC",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "coordinator",
      testMatch:
        /journey\.spec\.ts|gis\.spec\.ts|field-coordinator\.spec\.ts|field-integration\.spec\.ts|authorization\.spec\.ts|screenshots\.spec\.ts|accessibility\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/coordinator.json",
      },
    },
    {
      name: "admin",
      testMatch: /admin\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/admin.json",
      },
    },
    {
      // The technician surface is designed for a phone, so its suite runs at a phone viewport with
      // a synthetic geolocation. The point is on the reconstructed corridor and is nobody's home.
      name: "technician",
      testMatch: /field-technician\.spec\.ts|field-security\.spec\.ts|field-mobile\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Pixel 7"],
        storageState: "e2e/.auth/technician.json",
        permissions: ["geolocation"],
        geolocation: { longitude: -78.9412, latitude: -4.0761 },
      },
    },
    {
      name: "technician-two",
      testMatch: /field-foreign\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Pixel 7"],
        storageState: "e2e/.auth/technician2.json",
      },
    },
    {
      // Social Intelligence: the specialist is the only role that can start a run and settle a
      // coding, so the journey is theirs.
      name: "specialist",
      testMatch: /social\.spec\.ts|social-accessibility\.spec\.ts|social-screenshots\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/specialist.json",
      },
    },
    {
      name: "anonymous",
      testMatch: /anonymous\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 940 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm --filter @eia/web start --port ${PORT}`,
        url: `${baseURL}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
        // Better Auth binds its cookies and callbacks to an origin, so the server under test must
        // be told the origin the browser will actually use.
        env: {
          APP_ENV: "test",
          PUBLIC_APP_URL: baseURL,
          BETTER_AUTH_URL: baseURL,
          AUTH_TRUSTED_ORIGINS: baseURL,
        },
      },
});
