import { readFileSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

/**
 * The store the whole e2e stack shares (ADR-034).
 *
 * `pnpm e2e` starts one MinIO first (`tooling/scripts/e2e-storage.mjs`) and writes its
 * configuration here. Until Wave 3 this suite ran `STORAGE_PROVIDER=memory`, which is **per
 * process**: the web server held bytes no worker could see, so the upload pipeline could only ever
 * be proved in halves (TD-100). One real store is what lets `document-pipeline.spec.ts` follow a
 * file from a browser through storage and a worker to a citation.
 *
 * Absent, the suite still runs: every other spec is unaffected, and the pipeline spec skips with
 * the reason on screen rather than failing for a missing container.
 */
const STORAGE_CONFIG_PATH = process.env.EIA_E2E_STORAGE_CONFIG ?? "/tmp/eia-e2e-storage.json";

function storageEnv(): Record<string, string> {
  try {
    const config = JSON.parse(readFileSync(STORAGE_CONFIG_PATH, "utf8")) as {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
    };
    return {
      STORAGE_PROVIDER: "s3",
      STORAGE_ENDPOINT: config.endpoint,
      STORAGE_REGION: config.region,
      STORAGE_BUCKET: config.bucket,
      STORAGE_ACCESS_KEY_ID: config.accessKeyId,
      STORAGE_SECRET_ACCESS_KEY: config.secretAccessKey,
    };
  } catch {
    // `memory` is a real implementation of the port and is refused outside `local` and `test`,
    // so a developer who has not started the container keeps a working upload surface.
    return { STORAGE_PROVIDER: "memory" };
  }
}

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

/*
 * A second server, configured with a reference basemap, so both sides of the basemap contract are
 * covered by the same build.
 *
 * The default server has **no** provider — which is the deployed truth and the invariant that
 * matters most: no key, and the GIS surface is untouched. That leaves the configured path
 * untested, and the most important thing about it is what happens when the provider fails. So
 * this one is pointed at a tile template on its own origin that answers 404 for every tile: no
 * external request, no credential, nothing anybody bills — and the exact behaviour a revoked key
 * or an outage produces.
 *
 * It works because the basemap configuration is read at request time rather than inlined at build
 * time, so one build serves both.
 */
const BASEMAP_PORT = Number(process.env.E2E_BASEMAP_PORT ?? 3101);
const basemapBaseURL = `http://127.0.0.1:${BASEMAP_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  /*
   * One worker, no parallelism, and this is a decision rather than a default nobody revisited.
   *
   * The suite is not a set of independent checks over a read-only fixture. It is a series of
   * **journeys that write to one database**, and several of them depend on what an earlier project
   * left behind — the `dependencies` chains say so out loud:
   *
   *   setup → coordinator → document-pipeline → document-review → templates → second-project
   *
   * and beside them the technician's capture path, the correction revisit that corrects a response
   * the technician project submitted, the quality workflow whose reviewer settles a finding the
   * coordinator produced, the portal publication, and the report versions generated from data the
   * social project validated.
   *
   * Raising `workers` before Go-Live would trade about six minutes of wall clock for
   * nondeterministic races between suites that share rows — and the failure mode is not a red
   * build, it is a red build **sometimes**, which is the most expensive kind to diagnose. TD-118 is
   * a live demonstration of how much time one intermittent e2e failure costs.
   *
   * **The boundary for changing this**: parallelise only when each mutating suite can be given its
   * own project (or its own database) by an intentional fixture strategy, so that two workers
   * cannot touch the same rows. Sharding across runners has the same precondition. Until then the
   * honest optimisation is elsewhere — removing the duplicate workflow saved more than parallelism
   * would have, and deleted no coverage.
   */
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
        /(^|\/)(journey|mvp-journey|gis|field-coordinator|field-integration|authorization|screenshots|accessibility|documents|documents-accessibility|documents-screenshots|intake|pgas|reports|vocabulary|journey-integrity|reports-accessibility|reports-screenshots|portal|portal-accessibility|portal-screenshots)\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/coordinator.json",
      },
    },
    {
      /*
       * The whole pipeline, in one project of its own, after the coordinator's: browser → upload
       * intent → storage → QUEUED → worker → READY → chunks → search → a citation on screen. It
       * runs the real worker's own use-case from the test process against the same database and
       * the same MinIO, which is the only arrangement in which the topology is the product's.
       */
      name: "document-pipeline",
      testMatch: /(^|\/)document-pipeline\.spec\.ts$/,
      dependencies: ["setup", "coordinator"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/coordinator.json",
      },
    },
    {
      /*
       * AI document review (ADR-035), after the pipeline's: it uploads documents, has them read by
       * the extraction process, then asks for a review that a *second* separate process performs.
       * Serial, because the second test decides a candidate the first one's run produced.
       */
      name: "document-review",
      testMatch: /(^|\/)document-review\.spec\.ts$/,
      fullyParallel: false,
      dependencies: ["setup", "document-pipeline"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/coordinator.json",
      },
    },
    {
      /*
       * Study #2, through the product path (Wave 3): created on the Portfolio by the tenant owner,
       * prepared in the intake, and then checked for isolation against the pilot. Serial, because
       * the tests are stages of one act; last, because it adds a project every other project's
       * assertions would then have to account for.
       */
      name: "second-project",
      testMatch: /(^|\/)second-project\.spec\.ts$/,
      fullyParallel: false,
      dependencies: ["setup", "templates"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/owner.json",
      },
    },
    {
      /*
       * Correcting a submitted response (ADR-038). Serial — each test is a stage of one journey —
       * and after the technician project, because it corrects a response that suite submitted. It
       * drives two roles, so it opens its own pages rather than taking one storage state.
       */
      name: "survey-corrections",
      testMatch: /(^|\/)survey-corrections\.spec\.ts$/,
      fullyParallel: false,
      dependencies: ["setup", "technician"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/coordinator.json",
      },
    },
    {
      /*
       * Writing a questionnaire in the product (ADR-037). Serial — each test is a stage of one act
       * — and on its own project, because publishing a questionnaire into the pilot would change
       * what every other spec's counts and tabulations are about.
       */
      name: "survey-authoring",
      testMatch: /(^|\/)survey-authoring\.spec\.ts$/,
      fullyParallel: false,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/owner.json",
      },
    },
    {
      /*
       * The template library (ADR-036). Serial and after the review project, because each test
       * builds on the previous one's rows — a registered template, then a version, then an
       * activation, then a document.
       */
      name: "templates",
      testMatch: /(^|\/)templates\.spec\.ts$/,
      fullyParallel: false,
      dependencies: ["setup", "document-review"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/coordinator.json",
      },
    },
    {
      // Its own project, after the coordinator's, because it creates documents: a golden reference
      // taken afterwards would show the suite's own synthetic rows rather than the product.
      name: "document-upload",
      testMatch: /(^|\/)document-upload\.spec\.ts$/,
      dependencies: ["setup", "coordinator"],
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
      testMatch: /(^|\/)(social|social-accessibility|social-screenshots)\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/specialist.json",
      },
    },
    {
      // The Quality Gate has two personas, and the split is the point: a coordinator runs the
      // check and reads the findings, a reviewer settles them.
      name: "quality-coordinator",
      testMatch: /(^|\/)(quality|quality-accessibility|quality-screenshots)\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/coordinator.json",
      },
    },
    {
      name: "quality-reviewer",
      testMatch: /(^|\/)quality-review\.spec\.ts$/,
      dependencies: ["setup", "quality-coordinator"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/reviewer.json",
      },
    },
    {
      // The portal splits preparing from publishing, so the reviewer's half needs their session:
      // the assertion that matters is that the publish button is not on their screen. It depends
      // on the coordinator project, which is what creates the publication they inspect.
      name: "portal-reviewer",
      testMatch: /(^|\/)portal-reviewer\.spec\.ts$/,
      dependencies: ["setup", "coordinator"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 940 },
        storageState: "e2e/.auth/reviewer.json",
      },
    },
    {
      name: "basemap",
      testMatch: /(^|\/)gis-basemap\.spec\.ts$/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        baseURL: basemapBaseURL,
        storageState: "e2e/.auth/coordinator.json",
        viewport: { width: 1440, height: 940 },
      },
    },
    {
      name: "anonymous",
      // No stored session: these specs sign in for themselves, or test being signed out.
      testMatch: /(^|\/)(anonymous|session)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 940 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
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
            // Explicit, never defaulted (IG4-001): the deterministic classifier is selected here
            // because this is a test run, and nowhere else selects it for us.
            SOCIAL_CLASSIFIER: "fake",
            SOCIAL_CLASSIFIER_MODEL: "fake/deterministic",
            // And the third adapter (ADR-035). A run records which one answered, so nothing this
            // suite produces could later be read as a real model's output.
            DOCUMENT_REVIEWER: "fake",
            DOCUMENT_REVIEWER_MODEL: "fake/deterministic",
            // Also explicit, for the same reason (ADR-031): one shared MinIO when `pnpm e2e`
            // started it, and the per-process in-memory store otherwise. Neither is ever selected
            // by default — both are refused outside `local` and `test`.
            ...storageEnv(),
          },
        },

        {
          command: `pnpm --filter @eia/web start --port ${BASEMAP_PORT}`,
          url: `${basemapBaseURL}/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            APP_ENV: "test",
            PUBLIC_APP_URL: basemapBaseURL,
            BETTER_AUTH_URL: basemapBaseURL,
            AUTH_TRUSTED_ORIGINS: `${basemapBaseURL},${baseURL}`,
            SOCIAL_CLASSIFIER: "fake",
            SOCIAL_CLASSIFIER_MODEL: "fake/deterministic",
            // A self-hosted reference service that is not there: every tile answers 404, which is
            // what a revoked key, an expired plan or an outage looks like to the browser.
            BASEMAP_PROVIDER: "custom",
            BASEMAP_TILE_URL: `${basemapBaseURL}/reference-tiles/{z}/{x}/{y}.png`,
            BASEMAP_ATTRIBUTION: "Servicio de referencia de prueba",
          },
        },
      ],
});
