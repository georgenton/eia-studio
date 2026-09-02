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
});
