import { describe, expect, it } from "vitest";

import {
  EnvValidationError,
  appEnvSchema,
  authEnvSchema,
  loadEnv,
  migratorDatabaseEnvSchema,
  runtimeDatabaseEnvSchema,
  storageEnvSchema,
  workerEnvSchema,
} from "../src/index";

describe("loadEnv", () => {
  it("reads only declared keys and applies defaults", () => {
    const env = loadEnv("app", appEnvSchema, {
      PUBLIC_APP_URL: "http://localhost:3000",
      UNRELATED_SECRET: "should-not-be-read",
    });
    expect(env).toEqual({
      APP_ENV: "local",
      PUBLIC_APP_URL: "http://localhost:3000",
      LOG_LEVEL: "info",
      DEMO_FIXTURES_ENABLED: false,
    });
  });

  it("reports variable names, never values", () => {
    expect(() =>
      loadEnv("database", runtimeDatabaseEnvSchema, { DATABASE_URL: "mysql://secret-value" }),
    ).toThrowError(EnvValidationError);
    try {
      loadEnv("database", runtimeDatabaseEnvSchema, { DATABASE_URL: "mysql://secret-value" });
    } catch (error) {
      expect(String(error)).toContain("DATABASE_URL");
      expect(String(error)).not.toContain("secret-value");
    }
  });

  it("rejects demo fixtures in production", () => {
    expect(() =>
      loadEnv("app", appEnvSchema, {
        APP_ENV: "production",
        PUBLIC_APP_URL: "https://example.test",
        DEMO_FIXTURES_ENABLED: "true",
      }),
    ).toThrowError(/DEMO_FIXTURES_ENABLED/);
  });

  it("rejects an unverified database TLS mode in production", () => {
    const url = "postgres://app:pw@db.example.test:5432/eia";
    for (const mode of ["", "?sslmode=require", "?sslmode=no-verify", "?sslmode=disable"]) {
      expect(() =>
        loadEnv("database", runtimeDatabaseEnvSchema, {
          APP_ENV: "production",
          DATABASE_URL: `${url}${mode}`,
        }),
      ).toThrowError(/DATABASE_URL/);
    }
    expect(() =>
      loadEnv("migrator", migratorDatabaseEnvSchema, {
        APP_ENV: "production",
        DATABASE_MIGRATOR_URL: `${url}?sslmode=no-verify`,
      }),
    ).toThrowError(/DATABASE_MIGRATOR_URL/);
  });

  it("accepts verifying TLS modes in production and any mode elsewhere", () => {
    const url = "postgres://app:pw@db.example.test:5432/eia";
    for (const mode of ["verify-full", "verify-ca", "VERIFY-FULL"]) {
      expect(
        loadEnv("database", runtimeDatabaseEnvSchema, {
          APP_ENV: "production",
          DATABASE_URL: `${url}?sslmode=${mode}`,
        }).APP_ENV,
      ).toBe("production");
    }
    for (const appEnv of ["local", "test", "preview", "staging"]) {
      expect(
        loadEnv("database", runtimeDatabaseEnvSchema, {
          APP_ENV: appEnv,
          DATABASE_URL: `${url}?sslmode=no-verify`,
        }).DATABASE_URL,
      ).toContain("sslmode=no-verify");
    }
  });

  it("never reports the database URL when the production TLS rule fails", () => {
    try {
      loadEnv("database", runtimeDatabaseEnvSchema, {
        APP_ENV: "production",
        DATABASE_URL: "postgres://app:hunter2@db.example.test:5432/eia?sslmode=require",
      });
      expect.unreachable("expected the production TLS rule to reject this URL");
    } catch (error) {
      expect(String(error)).toContain("DATABASE_URL");
      expect(String(error)).not.toContain("hunter2");
    }
  });

  it("requires a long auth secret and parses trusted origins", () => {
    expect(() =>
      loadEnv("auth", authEnvSchema, { BETTER_AUTH_SECRET: "short", BETTER_AUTH_URL: "http://x" }),
    ).toThrowError(/BETTER_AUTH_SECRET/);
    const env = loadEnv("auth", authEnvSchema, {
      BETTER_AUTH_SECRET: "a".repeat(40),
      BETTER_AUTH_URL: "http://localhost:3000",
      AUTH_TRUSTED_ORIGINS: "http://a.test, http://b.test",
    });
    expect(env.AUTH_TRUSTED_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });

  it("storage is all-or-nothing", () => {
    expect(loadEnv("storage", storageEnvSchema, {}).configured).toBe(false);
    expect(() => loadEnv("storage", storageEnvSchema, { STORAGE_BUCKET: "b" })).toThrowError(
      /STORAGE_\*/,
    );
    const full = loadEnv("storage", storageEnvSchema, {
      STORAGE_ENDPOINT: "http://localhost:9000",
      STORAGE_REGION: "auto",
      STORAGE_BUCKET: "eia",
      STORAGE_ACCESS_KEY_ID: "k",
      STORAGE_SECRET_ACCESS_KEY: "s",
    });
    expect(full.configured).toBe(true);
  });

  it("coerces worker numbers and booleans", () => {
    const env = loadEnv("worker", workerEnvSchema, {
      WORKER_HEALTH_PORT: "0",
      WORKER_DB_CHECK: "false",
    });
    expect(env.WORKER_HEALTH_PORT).toBe(0);
    expect(env.WORKER_DB_CHECK).toBe(false);
    expect(env.WORKER_HEARTBEAT_MS).toBe(15_000);
  });
});
