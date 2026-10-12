import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }));

import { fieldConfig, MisconfiguredFieldBuild } from "../src/config";

/**
 * The label a technician reads before signing in.
 *
 * It is worth a test of its own because the failure it guards is not a crash: it is a correct
 * application, pointed at the right backend, telling the person holding it the wrong thing about
 * where their work is going.
 */
const saved = { url: process.env["EXPO_PUBLIC_API_URL"], env: process.env["EXPO_PUBLIC_APP_ENV"] };

function build(url: string | undefined, env: string | undefined): void {
  if (url === undefined) delete process.env["EXPO_PUBLIC_API_URL"];
  else process.env["EXPO_PUBLIC_API_URL"] = url;
  if (env === undefined) delete process.env["EXPO_PUBLIC_APP_ENV"];
  else process.env["EXPO_PUBLIC_APP_ENV"] = env;
}

beforeEach(() => build(undefined, undefined));
afterEach(() => build(saved.url, saved.env));

describe("what the build says it is", () => {
  it("names staging as a test environment, never as production", () => {
    build("https://vih786wuduzmldekoq3zdies.syntavera.dev", "staging");
    const c = fieldConfig();
    expect(c.environment).toBe("staging");
    expect(c.environmentLabel).toContain("STAGING");
    expect(c.environmentLabel).not.toContain("Producción");
    expect(c.apiBaseUrl).toBe("https://vih786wuduzmldekoq3zdies.syntavera.dev");
  });

  /*
   * The regression this whole change exists for: before, any host that was neither localhost nor
   * vercel.app read as "Producción". The staging host is exactly such a host.
   */
  it("does not infer the environment from the hostname", () => {
    build("https://vih786wuduzmldekoq3zdies.syntavera.dev", "staging");
    const staging = fieldConfig().environmentLabel;
    build("https://vih786wuduzmldekoq3zdies.syntavera.dev", "production");
    expect(fieldConfig().environmentLabel).not.toBe(staging);
  });

  it("trims a trailing slash off the API URL", () => {
    build("https://vih786wuduzmldekoq3zdies.syntavera.dev///", "staging");
    expect(fieldConfig().apiBaseUrl).toBe("https://vih786wuduzmldekoq3zdies.syntavera.dev");
  });

  it("still reads as local development when nothing is declared", () => {
    expect(fieldConfig().environment).toBe("local");
    expect(fieldConfig().apiBaseUrl).toBe("http://localhost:3000");
  });
});

describe("a build that does not add up refuses to describe itself", () => {
  /* A staging build with no URL would reach nothing, and say nothing about why. */
  it("refuses a staging build that fell back to localhost", () => {
    build(undefined, "staging");
    expect(() => fieldConfig()).toThrow(MisconfiguredFieldBuild);
  });

  it("refuses a production build that fell back to localhost", () => {
    build(undefined, "production");
    expect(() => fieldConfig()).toThrow(MisconfiguredFieldBuild);
  });

  it("refuses a local build aimed at a remote host", () => {
    build("https://vih786wuduzmldekoq3zdies.syntavera.dev", "local");
    expect(() => fieldConfig()).toThrow(MisconfiguredFieldBuild);
  });

  /* A typo loses the build rather than the labelling, and never reads as "Producción". */
  it("refuses an environment word it does not know", () => {
    build("https://vih786wuduzmldekoq3zdies.syntavera.dev", "stagin");
    expect(() => fieldConfig()).toThrow(MisconfiguredFieldBuild);
  });
});
