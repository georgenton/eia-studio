import { describe, expect, it } from "vitest";

import { loadWorkerConfig } from "../src/config";

describe("loadWorkerConfig", () => {
  it("requires DATABASE_URL only when the db check is on", () => {
    const withoutDb = loadWorkerConfig({
      PUBLIC_APP_URL: "http://localhost:3000",
      WORKER_DB_CHECK: "false",
    });
    expect(withoutDb.database).toBeNull();
    expect(() => loadWorkerConfig({ PUBLIC_APP_URL: "http://localhost:3000" })).toThrow(
      /DATABASE_URL/,
    );
    const withDb = loadWorkerConfig({
      PUBLIC_APP_URL: "http://localhost:3000",
      DATABASE_URL: "postgres://app:secret@localhost:5432/eia",
    });
    expect(withDb.database?.DATABASE_URL).toContain("postgres://");
  });

  it("rejects invalid values by variable name without echoing values", () => {
    try {
      loadWorkerConfig({
        PUBLIC_APP_URL: "not-a-url",
        WORKER_DB_CHECK: "false",
        WORKER_HEALTH_PORT: "99999",
      });
      expect.fail("should throw");
    } catch (error) {
      const message = String(error);
      expect(message).toContain("PUBLIC_APP_URL");
      expect(message).not.toContain("not-a-url");
    }
  });

  /**
   * IG4-001. The worker resolves availability at startup and *keeps running* when there is none:
   * refusing to boot would take the health endpoint down over a feature the deployment may not
   * even use. What it must not do is claim classification work — `main.ts` only constructs the
   * consumer for an `AVAILABLE` classifier.
   */
  it("has no classifier when SOCIAL_CLASSIFIER is unset, and still loads", () => {
    const config = loadWorkerConfig({
      PUBLIC_APP_URL: "http://localhost:3000",
      WORKER_DB_CHECK: "false",
    });
    expect(config.classifier).toMatchObject({ state: "UNAVAILABLE", reason: "NOT_CONFIGURED" });
  });

  it("refuses the deterministic fake in a persistent environment", () => {
    const config = loadWorkerConfig({
      APP_ENV: "staging",
      PUBLIC_APP_URL: "https://staging.example",
      WORKER_DB_CHECK: "false",
      SOCIAL_CLASSIFIER: "fake",
    });
    expect(config.classifier).toMatchObject({
      state: "UNAVAILABLE",
      reason: "FAKE_REFUSED_IN_PERSISTENT_ENVIRONMENT",
    });
  });

  it("reports BLOCKED_EXTERNAL_CONFIG when the gateway has no credential, rather than failing", () => {
    const config = loadWorkerConfig({
      APP_ENV: "staging",
      PUBLIC_APP_URL: "https://staging.example",
      WORKER_DB_CHECK: "false",
      SOCIAL_CLASSIFIER: "ai-gateway",
      SOCIAL_CLASSIFIER_MODEL: "anthropic/claude-sonnet-4.5",
    });
    expect(config.classifier).toMatchObject({
      state: "UNAVAILABLE",
      reason: "BLOCKED_EXTERNAL_CONFIG",
    });
  });

  it("accepts the fake where it belongs", () => {
    const config = loadWorkerConfig({
      APP_ENV: "test",
      PUBLIC_APP_URL: "http://localhost:3000",
      WORKER_DB_CHECK: "false",
      SOCIAL_CLASSIFIER: "fake",
    });
    expect(config.classifier).toMatchObject({ state: "AVAILABLE", kind: "fake", live: false });
  });
});
