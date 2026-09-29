import { appEnvSchema, APP_ENVIRONMENTS, loadEnv } from "@eia/contracts";
import {
  isPersistentEnvironment,
  isPersistentStorageEnvironment,
  resolveClassifierAvailability,
  resolveDocumentReviewerAvailability,
  resolveStorageAvailability,
} from "@eia/domain";
import { describe, expect, it } from "vitest";

/**
 * *What may each environment do?* — asked once, over the whole enum.
 *
 * The Cinta Vera model adds a fourth permanent deployment target, `demo`, beside `preview`,
 * `staging` and `production`. A showcase environment is the one most likely to be handed a
 * convenient shortcut — a `fake` classifier so the coding queue looks alive, an in-memory store so
 * nobody has to configure a bucket — and those shortcuts are exactly what IG4-001 and ADR-031
 * exist to refuse, because a row produced by a stand-in is indistinguishable afterwards from a
 * real one.
 *
 * So the matrix is asserted rather than assumed, and it is asserted **over `APP_ENVIRONMENTS`**:
 * adding a seventh environment later fails this file until somebody decides what it may do.
 */

/** The only two environments where a deterministic stand-in may run. */
const EPHEMERAL = ["local", "test"] as const;
const PERSISTENT = APP_ENVIRONMENTS.filter((e) => !(EPHEMERAL as readonly string[]).includes(e));

const APP_URL = "https://example.test";

describe("the environment enum", () => {
  it("contains demo, between preview and staging", () => {
    expect(APP_ENVIRONMENTS).toEqual(["local", "test", "preview", "demo", "staging", "production"]);
  });

  it("every environment parses, and none enables demo fixtures by default", () => {
    for (const appEnv of APP_ENVIRONMENTS) {
      const env = loadEnv("app", appEnvSchema, { APP_ENV: appEnv, PUBLIC_APP_URL: APP_URL });
      expect(env.APP_ENV, appEnv).toBe(appEnv);
      expect(env.DEMO_FIXTURES_ENABLED, appEnv).toBe(false);
    }
  });
});

describe("demo fixtures", () => {
  it("are an explicit opt-in in demo, never implicit", () => {
    const off = loadEnv("app", appEnvSchema, { APP_ENV: "demo", PUBLIC_APP_URL: APP_URL });
    expect(off.DEMO_FIXTURES_ENABLED).toBe(false);

    const on = loadEnv("app", appEnvSchema, {
      APP_ENV: "demo",
      PUBLIC_APP_URL: APP_URL,
      DEMO_FIXTURES_ENABLED: "true",
    });
    expect(on.DEMO_FIXTURES_ENABLED).toBe(true);
  });

  it("do not become enabled in staging merely because demo exists", () => {
    // The two are separate deployments with separate configuration. Nothing about `demo` being a
    // legal value may leak an opt-in into the environment that gates production.
    const staging = loadEnv("app", appEnvSchema, { APP_ENV: "staging", PUBLIC_APP_URL: APP_URL });
    expect(staging.DEMO_FIXTURES_ENABLED).toBe(false);
  });

  it("are refused in production whatever else is set", () => {
    expect(() =>
      loadEnv("app", appEnvSchema, {
        APP_ENV: "production",
        PUBLIC_APP_URL: APP_URL,
        DEMO_FIXTURES_ENABLED: "true",
      }),
    ).toThrowError(/DEMO_FIXTURES_ENABLED/);
  });
});

describe("a stand-in classifier", () => {
  it("runs only in local and test", () => {
    for (const appEnv of EPHEMERAL) {
      expect(
        resolveClassifierAvailability({
          appEnv,
          classifier: "fake",
          model: undefined,
          gatewayApiKeyPresent: false,
        }),
        appEnv,
      ).toMatchObject({ state: "AVAILABLE", live: false });
    }
  });

  it("is refused in every persistent environment, demo included", () => {
    for (const appEnv of PERSISTENT) {
      for (const resolve of [resolveClassifierAvailability, resolveDocumentReviewerAvailability]) {
        const result = resolve({
          appEnv,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          classifier: "fake" as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          reviewer: "fake" as any,
          model: undefined,
          gatewayApiKeyPresent: false,
        } as never);
        expect(result.state, `${appEnv} / ${resolve.name}`).toBe("UNAVAILABLE");
      }
    }
    expect(PERSISTENT).toContain("demo");
  });

  it("treats demo as persistent by the same predicate as staging and production", () => {
    expect(isPersistentEnvironment("demo")).toBe(true);
    expect(isPersistentEnvironment("staging")).toBe(true);
    expect(isPersistentEnvironment("production")).toBe(true);
    expect(isPersistentEnvironment("local")).toBe(false);
    expect(isPersistentEnvironment("test")).toBe(false);
  });
});

describe("the in-memory object store", () => {
  it("runs only in local and test", () => {
    for (const appEnv of EPHEMERAL) {
      expect(
        resolveStorageAvailability({
          appEnv,
          provider: "memory",
          bucket: undefined,
          endpoint: undefined,
          region: undefined,
          credentialsPresent: false,
        }),
        appEnv,
      ).toMatchObject({ state: "AVAILABLE", provider: "memory" });
    }
  });

  it("is refused in every persistent environment, demo included", () => {
    for (const appEnv of PERSISTENT) {
      expect(
        resolveStorageAvailability({
          appEnv,
          provider: "memory",
          bucket: undefined,
          endpoint: undefined,
          region: undefined,
          credentialsPresent: false,
        }).state,
        appEnv,
      ).toBe("UNAVAILABLE");
    }
    expect(isPersistentStorageEnvironment("demo")).toBe(true);
  });

  it("leaves demo without storage rather than falling back, when nothing is configured", () => {
    // ADR-031: unset is unavailable. A demo that silently stored documents in a process that later
    // exits would look like it worked until somebody needed the file.
    expect(
      resolveStorageAvailability({
        appEnv: "demo",
        provider: undefined,
        bucket: undefined,
        endpoint: undefined,
        region: undefined,
        credentialsPresent: false,
      }).state,
    ).toBe("UNAVAILABLE");
  });
});
