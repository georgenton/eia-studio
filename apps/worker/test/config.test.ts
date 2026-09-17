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

/**
 * Whether this worker can read an uploaded file at all (ADR-033).
 *
 * The same rule as the classifier's, one layer over: **a worker with no usable storage never
 * claims.** Claiming and then failing at the first fetch would drain the extraction queue and mark
 * every document `FAILED` over a missing environment variable — an outcome a consultant would read
 * as *these documents are broken*.
 */
describe("worker storage resolution", () => {
  const base = {
    PUBLIC_APP_URL: "https://staging.example",
    WORKER_DB_CHECK: "false",
  } as const;

  it("is unavailable when nothing is configured, and the process still starts", () => {
    const config = loadWorkerConfig({ ...base, APP_ENV: "staging" });
    expect(config.storage).toMatchObject({ state: "UNAVAILABLE", reason: "NOT_CONFIGURED" });
  });

  it("refuses the in-memory store in a persistent environment", () => {
    const config = loadWorkerConfig({ ...base, APP_ENV: "staging", STORAGE_PROVIDER: "memory" });
    expect(config.storage).toMatchObject({
      state: "UNAVAILABLE",
      reason: "MEMORY_REFUSED_IN_PERSISTENT_ENVIRONMENT",
    });
  });

  it("reports BLOCKED_EXTERNAL_CONFIG for a half-configured provider, rather than failing", () => {
    const config = loadWorkerConfig({
      ...base,
      APP_ENV: "staging",
      STORAGE_PROVIDER: "s3",
      STORAGE_BUCKET: "eia",
    });
    expect(config.storage).toMatchObject({
      state: "UNAVAILABLE",
      reason: "BLOCKED_EXTERNAL_CONFIG",
    });
  });

  it("is available, and carries what the adapter needs, when it is complete", () => {
    const config = loadWorkerConfig({
      ...base,
      APP_ENV: "production",
      STORAGE_PROVIDER: "s3",
      STORAGE_BUCKET: "eia",
      STORAGE_REGION: "auto",
      STORAGE_ENDPOINT: "https://store.example",
      STORAGE_ACCESS_KEY_ID: "k",
      STORAGE_SECRET_ACCESS_KEY: "s",
    });
    expect(config.storage).toMatchObject({ state: "AVAILABLE", provider: "s3", live: true });
    expect(config.storageConfig.bucket).toBe("eia");
  });
});
