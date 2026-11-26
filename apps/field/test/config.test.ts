import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }));

import {
  ENVIRONMENT_ORIGINS,
  ENVIRONMENT_SCHEMES,
  fieldConfig,
  MisconfiguredFieldBuild,
  STAGING_ORIGIN,
} from "../src/config";

/**
 * Which backend a build talks to, and what it tells the technician it is.
 *
 * The first version of this guard only checked one axis — remote versus localhost — which left
 * the two cases that matter open: a **staging** build aimed at production, and a **production**
 * build aimed at staging. The first writes synthetic answers into a real study; the second shows
 * a client a study that does not exist. A label does not catch either, because by then the label
 * is the lie.
 *
 * So the pairs are enumerated here, both the ones that must work and the ones that must refuse.
 * No network is touched: the production URL below is a unit-test placeholder, and the production
 * host is still undecided.
 */
const PRODUCTION_ORIGIN = ENVIRONMENT_ORIGINS.production;
const DEMO_ORIGIN = ENVIRONMENT_ORIGINS.demo;
const RETIRED_UAT = "https://eia-field-uat.vercel.app";
/** A host that is plausible and is not any of the three. Every build must refuse it. */
const STRANGER = "https://campo.example.invalid";

const saved = { url: process.env["EXPO_PUBLIC_API_URL"], env: process.env["EXPO_PUBLIC_APP_ENV"] };

function build(url: string | undefined, env: string | undefined): void {
  if (url === undefined) delete process.env["EXPO_PUBLIC_API_URL"];
  else process.env["EXPO_PUBLIC_API_URL"] = url;
  if (env === undefined) delete process.env["EXPO_PUBLIC_APP_ENV"];
  else process.env["EXPO_PUBLIC_APP_ENV"] = env;
}

beforeEach(() => build(undefined, undefined));
afterEach(() => build(saved.url, saved.env));

describe("the four builds that are allowed", () => {
  it("staging, at the accepted Coolify origin", () => {
    build(STAGING_ORIGIN, "staging");
    const c = fieldConfig();
    expect(c.environment).toBe("staging");
    expect(c.apiBaseUrl).toBe(STAGING_ORIGIN);
    expect(c.environmentLabel).toContain("STAGING");
    expect(c.environmentLabel).not.toContain("Producción");
  });

  it("local, at localhost", () => {
    build("http://localhost:3000", "local");
    const c = fieldConfig();
    expect(c.environment).toBe("local");
    expect(c.environmentLabel).toBe("Desarrollo local");
  });

  it("local, at the loopback address", () => {
    build("http://127.0.0.1:3000", "local");
    const c = fieldConfig();
    expect(c.environment).toBe("local");
    expect(c.apiBaseUrl).toBe("http://127.0.0.1:3000");
  });

  it("production, at the verified production origin", () => {
    build(PRODUCTION_ORIGIN, "production");
    const c = fieldConfig();
    expect(c.environment).toBe("production");
    expect(c.apiBaseUrl).toBe(PRODUCTION_ORIGIN);
    expect(c.environmentLabel).toBe("Producción");
  });

  /*
   * The environment `eas.json` and `app.config.ts` have admitted since the three-identity change,
   * and that this contract refused outright until now: `readEnvironment("demo")` threw, so the
   * demo APK could not construct its auth client and failed at launch.
   */
  it("demo, at the demo origin", () => {
    build(DEMO_ORIGIN, "demo");
    const c = fieldConfig();
    expect(c.environment).toBe("demo");
    expect(c.apiBaseUrl).toBe(DEMO_ORIGIN);
    expect(c.environmentLabel).toContain("DEMO");
    expect(c.environmentLabel).not.toContain("Producción");
  });

  /** One scheme per installable application: two builds claiming one scheme is a coin toss. */
  it("gives each environment its own deep-link scheme, and they are all different", () => {
    const seen = new Map<string, string>();
    for (const [environment, origin] of Object.entries(ENVIRONMENT_ORIGINS)) {
      build(origin, environment);
      const c = fieldConfig();
      expect(c.scheme).toBe(ENVIRONMENT_SCHEMES[c.environment]);
      seen.set(environment, c.scheme);
    }
    expect(new Set(seen.values()).size).toBe(seen.size);
    // The installed staging application keeps the scheme it already claims.
    expect(seen.get("staging")).toBe("eiafield");
  });

  it("still reads as local development when nothing is declared", () => {
    expect(fieldConfig().environment).toBe("local");
    expect(fieldConfig().apiBaseUrl).toBe("http://localhost:3000");
  });

  it("trims a trailing slash before comparing the origin", () => {
    build(`${STAGING_ORIGIN}///`, "staging");
    expect(fieldConfig().apiBaseUrl).toBe(STAGING_ORIGIN);
  });
});

describe("a build whose environment and target disagree refuses to exist", () => {
  const refused: ReadonlyArray<readonly [string, string | undefined, string]> = [
    ["staging aimed at the production host", PRODUCTION_ORIGIN, "staging"],
    ["staging aimed at the demo host", DEMO_ORIGIN, "staging"],
    ["demo aimed at the staging host", STAGING_ORIGIN, "demo"],
    ["demo aimed at the production host", PRODUCTION_ORIGIN, "demo"],
    ["demo aimed at localhost", "http://localhost:3000", "demo"],
    ["demo with no URL at all", undefined, "demo"],
    ["demo aimed at a stranger", STRANGER, "demo"],
    ["production aimed at the demo host", DEMO_ORIGIN, "production"],
    ["production aimed at a stranger", STRANGER, "production"],
    ["staging aimed at a stranger", STRANGER, "staging"],
    ["staging aimed at the retired Vercel UAT host", RETIRED_UAT, "staging"],
    ["staging aimed at localhost", "http://localhost:3000", "staging"],
    ["staging with no URL at all", undefined, "staging"],
    ["production aimed at the staging host", STAGING_ORIGIN, "production"],
    ["production aimed at localhost", "http://localhost:3000", "production"],
    ["production with no URL at all", undefined, "production"],
    [
      "production still carrying the placeholder",
      "https://REPLACE-WITH-PRODUCTION-HOST",
      "production",
    ],
    ["production over plain HTTP", PRODUCTION_ORIGIN.replace("https://", "http://"), "production"],
    ["local aimed at a remote host", STAGING_ORIGIN, "local"],
    ["an environment word nobody declared", STAGING_ORIGIN, "stagin"],

    /*
     * Below: targets a *string* comparison accepted. Each one is either the staging origin in
     * another spelling, or a remote host wearing a loopback prefix. `startsWith` read them as
     * different, or as local; `URL` reads them as what they are.
     */
    [
      "local aimed at a host that merely begins with localhost",
      "http://localhost.evil.invalid",
      "local",
    ],
    [
      "local aimed at a host that merely begins with the loopback address",
      "http://127.0.0.1.evil.invalid",
      "local",
    ],
    ["production aimed at loopback over HTTPS", "https://localhost:3000", "production"],
    ["production aimed at the loopback address over HTTPS", "https://127.0.0.1:3000", "production"],
    ["production aimed at a path under the staging host", `${STAGING_ORIGIN}/api`, "production"],
    [
      "production aimed at the staging host with a query string",
      `${STAGING_ORIGIN}?x=1`,
      "production",
    ],
    [
      "production aimed at the staging host with its default port spelled out",
      `${STAGING_ORIGIN}:443`,
      "production",
    ],
    [
      "production aimed at the staging host with embedded credentials",
      STAGING_ORIGIN.replace("https://", "https://tecnico:hunter2@"),
      "production",
    ],
    [
      "production aimed at any remote host with embedded credentials",
      `https://tecnico:hunter2@${new URL(PRODUCTION_ORIGIN).host}`,
      "production",
    ],
    ["production aimed at a path under its own host", `${PRODUCTION_ORIGIN}/api`, "production"],
    [
      "production aimed at a remote host with a fragment",
      "https://campo.example.invalid#token",
      "production",
    ],
    ["production given something that is not a URL at all", "campo.example.invalid", "production"],
    [
      "production given a scheme this build cannot speak",
      "ftp://campo.example.invalid",
      "production",
    ],
  ];

  for (const [name, url, env] of refused) {
    it(`refuses ${name}`, () => {
      build(url, env);
      expect(() => fieldConfig()).toThrow(MisconfiguredFieldBuild);
    });
  }
});

describe("what an error is allowed to say", () => {
  /*
   * The origin is public — it is in the bundle either way — but a URL can carry `user:password@`,
   * and an error message travels into build logs, which a bundle does not. So a message names the
   * host and never the whole URL.
   */
  it("names the host, not the URL, and never embedded credentials", () => {
    build("https://tecnico:hunter2@otro.example.invalid", "staging");
    let message = "";
    try {
      fieldConfig();
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("tecnico");
    expect(message).toContain("embedded credentials");
  });

  it("says nothing about a path or a query it refused", () => {
    build(`${STAGING_ORIGIN}/api?token=hunter2#hunter2`, "production");
    let message = "";
    try {
      fieldConfig();
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("token");
    expect(message).not.toContain("/api");
    // It still has to be useful: the host is public and naming it is how somebody fixes the build.
    expect(message).toContain("eia-staging.syntavera.dev");
  });
});
