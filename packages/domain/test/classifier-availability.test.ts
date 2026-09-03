import { describe, expect, it } from "vitest";

import {
  AiUnavailable,
  isPersistentEnvironment,
  requireAvailableClassifier,
  resolveClassifierAvailability,
} from "../src/index";

/**
 * IG4-001: a persistent environment must never silently classify with the deterministic fake.
 *
 * The regression this guards is not a crash — it is a table of `ai_classification` rows produced
 * by a keyword matcher that nobody could afterwards distinguish from a model's proposals. The old
 * `SOCIAL_CLASSIFIER` default of `fake` made that the outcome of doing nothing.
 */
const key = { gatewayApiKeyPresent: true, model: "anthropic/claude-sonnet-4.5" };
const noKey = { gatewayApiKeyPresent: false, model: "anthropic/claude-sonnet-4.5" };

describe("where a deterministic fake may run", () => {
  it("runs in local and test, when it was asked for explicitly", () => {
    for (const appEnv of ["local", "test"]) {
      const availability = resolveClassifierAvailability({
        appEnv,
        classifier: "fake",
        model: "fake/deterministic",
        gatewayApiKeyPresent: false,
      });
      expect(availability, appEnv).toMatchObject({ state: "AVAILABLE", kind: "fake", live: false });
    }
  });

  it("is refused in every persistent environment, however it got there", () => {
    for (const appEnv of ["preview", "staging", "production"]) {
      const availability = resolveClassifierAvailability({
        appEnv,
        classifier: "fake",
        model: "fake/deterministic",
        gatewayApiKeyPresent: false,
      });
      expect(availability, appEnv).toMatchObject({
        state: "UNAVAILABLE",
        reason: "FAKE_REFUSED_IN_PERSISTENT_ENVIRONMENT",
      });
    }
  });

  it("treats an environment nobody anticipated as persistent", () => {
    // Fail closed: a misspelt APP_ENV loses assisted coding rather than gaining a fake one.
    expect(isPersistentEnvironment("stagign")).toBe(true);
    expect(
      resolveClassifierAvailability({
        appEnv: "stagign",
        classifier: "fake",
        model: "fake/deterministic",
        gatewayApiKeyPresent: false,
      }),
    ).toMatchObject({ state: "UNAVAILABLE", reason: "FAKE_REFUSED_IN_PERSISTENT_ENVIRONMENT" });
  });
});

describe("an unset classifier means no assisted coding, not a default one", () => {
  it("is unavailable everywhere, including local", () => {
    for (const appEnv of ["local", "test", "preview", "staging", "production"]) {
      expect(
        resolveClassifierAvailability({
          appEnv,
          classifier: undefined,
          model: undefined,
          gatewayApiKeyPresent: false,
        }),
        appEnv,
      ).toMatchObject({ state: "UNAVAILABLE", reason: "NOT_CONFIGURED" });
    }
  });
});

describe("the live adapter and its external configuration", () => {
  it("is available in a persistent environment when its credential is present", () => {
    expect(
      resolveClassifierAvailability({ appEnv: "staging", classifier: "ai-gateway", ...key }),
    ).toEqual({
      state: "AVAILABLE",
      kind: "ai-gateway",
      model: "anthropic/claude-sonnet-4.5",
      live: true,
    });
  });

  it("is BLOCKED_EXTERNAL_CONFIG without the credential — and never demoted to the fake", () => {
    const availability = resolveClassifierAvailability({
      appEnv: "staging",
      classifier: "ai-gateway",
      ...noKey,
    });
    expect(availability).toMatchObject({
      state: "UNAVAILABLE",
      reason: "BLOCKED_EXTERNAL_CONFIG",
    });
    expect(JSON.stringify(availability)).not.toContain('"kind"');
  });

  it("is blocked when the model id does not name its provider", () => {
    // The gateway would resolve something other than what the run records, making
    // `requested_model` a fiction.
    for (const model of ["claude-sonnet-4.5", "", undefined]) {
      expect(
        resolveClassifierAvailability({
          appEnv: "staging",
          classifier: "ai-gateway",
          model,
          gatewayApiKeyPresent: true,
        }),
        String(model),
      ).toMatchObject({ state: "UNAVAILABLE", reason: "BLOCKED_EXTERNAL_CONFIG" });
    }
  });

  it("never leaks the credential's value, because it never receives one", () => {
    const availability = resolveClassifierAvailability({
      appEnv: "staging",
      classifier: "ai-gateway",
      ...noKey,
    });
    expect(availability.state === "UNAVAILABLE" && availability.detail).toContain(
      "AI_GATEWAY_API_KEY",
    );
    expect(availability.state === "UNAVAILABLE" && availability.detail).not.toMatch(/sk-|Bearer/);
  });
});

describe("the gate every write path takes", () => {
  it("returns the usable classifier unchanged when it is available", () => {
    const availability = resolveClassifierAvailability({
      appEnv: "test",
      classifier: "fake",
      model: "fake/deterministic",
      gatewayApiKeyPresent: false,
    });
    expect(requireAvailableClassifier(availability).kind).toBe("fake");
  });

  it("throws AiUnavailable carrying the reason, so a caller can say which one it was", () => {
    const availability = resolveClassifierAvailability({
      appEnv: "staging",
      classifier: "ai-gateway",
      ...noKey,
    });
    try {
      requireAvailableClassifier(availability);
      expect.unreachable("an unavailable classifier must not be usable");
    } catch (error) {
      expect(error).toBeInstanceOf(AiUnavailable);
      expect((error as AiUnavailable).reason).toBe("BLOCKED_EXTERNAL_CONFIG");
      expect((error as AiUnavailable).code).toBe("AI_UNAVAILABLE");
    }
  });
});
