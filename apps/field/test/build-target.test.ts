import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExpoConfig } from "expo/config";
import { beforeAll, describe, expect, it, vi } from "vitest";

/*
 * `src/config.ts` imports `expo-constants`, which pulls the React Native source tree into the
 * transform. This file only needs the constants the contract declares, so the module is stubbed —
 * the same stub `config.test.ts` uses.
 */
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.1.0" } } }));

import { APP_ENVIRONMENTS, ENVIRONMENT_ORIGINS, ENVIRONMENT_SCHEMES } from "../src/config";

/**
 * Which backend a build talks to, and what it tells the technician it is.
 *
 * These two facts used to be one: the environment was **inferred** from the hostname —
 * `localhost` meant development, `vercel.app` meant test, and **anything else meant
 * "Producción"**. That inference held only while the test backend lived on Vercel. When staging
 * moved to its own host, the same build pointed at staging would have greeted the technician with
 * the word *Producción*, which is the one word nobody re-reads before typing a household's
 * answers.
 *
 * So the profile declares both, and this file checks they agree. It is deliberately a test about
 * `eas.json`, not a configuration framework: there are three profiles and they are enumerated.
 */
const here = dirname(fileURLToPath(import.meta.url));
const eas = JSON.parse(readFileSync(resolve(here, "../eas.json"), "utf8")) as {
  build: Record<
    string,
    {
      env?: Record<string, string>;
      channel?: string;
      distribution?: string;
      android?: { buildType?: string };
    }
  >;
};
const STAGING_HOST = "https://eia-staging.syntavera.dev";
const PRODUCTION_HOST = "https://eia.syntavera.dev";
const DEMO_HOST = "https://eia-demo.syntavera.dev";

/**
 * The resolved manifest for one environment.
 *
 * `app.json` is gone: a static manifest describes one Android package and this application is now
 * three installable builds. `app.config.ts` is a function of `EXPO_PUBLIC_APP_ENV`, so the gate
 * resolves it the same way a build does rather than asserting against a copy of its contents.
 */
async function manifestFor(environment: string) {
  const previous = process.env.EXPO_PUBLIC_APP_ENV;
  process.env.EXPO_PUBLIC_APP_ENV = environment;
  try {
    const module = (await import("../app.config")) as { default: () => ExpoConfig };
    return module.default();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
    else process.env.EXPO_PUBLIC_APP_ENV = previous;
  }
}

describe("the staging build points at the accepted staging backend", () => {
  it("targets the Coolify host, not the retired Vercel UAT one", () => {
    expect(eas.build.staging?.env?.["EXPO_PUBLIC_API_URL"]).toBe(STAGING_HOST);
  });

  /*
   * Named rather than merely absent. `eia-field-uat.vercel.app` was a real deployment this
   * application really pointed at, and a build that silently went back to it would reach a
   * backend running neither the accepted release nor the rebuilt database.
   */
  it("does not point at the retired UAT host anywhere", () => {
    for (const [name, profile] of Object.entries(eas.build)) {
      expect(profile.env?.["EXPO_PUBLIC_API_URL"] ?? "", name).not.toContain("eia-field-uat");
    }
  });

  it("declares its environment beside its URL, in every profile", () => {
    expect(eas.build.development?.env?.["EXPO_PUBLIC_APP_ENV"]).toBe("local");
    expect(eas.build.demo?.env?.["EXPO_PUBLIC_APP_ENV"]).toBe("demo");
    expect(eas.build.staging?.env?.["EXPO_PUBLIC_APP_ENV"]).toBe("staging");
    expect(eas.build.production?.env?.["EXPO_PUBLIC_APP_ENV"]).toBe("production");
  });

  /*
   * The placeholder this replaced. `https://REPLACE-WITH-PRODUCTION-HOST` was in the production
   * profile for two months: a build made from it would have failed at the first request, which is
   * the good outcome, but it also meant nobody could produce a production build at all.
   */
  it("points production at the verified production host, not a placeholder", () => {
    expect(eas.build.production?.env?.["EXPO_PUBLIC_API_URL"]).toBe(PRODUCTION_HOST);
    expect(eas.build.demo?.env?.["EXPO_PUBLIC_API_URL"]).toBe(DEMO_HOST);
    for (const [name, profile] of Object.entries(eas.build)) {
      expect(profile.env?.["EXPO_PUBLIC_API_URL"] ?? "", name).not.toContain("REPLACE-WITH");
    }
  });

  it("gives every environment its own backend and its own channel", () => {
    const urls = ["demo", "staging", "production"].map(
      (p) => eas.build[p]?.env?.["EXPO_PUBLIC_API_URL"],
    );
    expect(new Set(urls).size).toBe(3);
    expect(eas.build.demo?.channel).toBe("demo");
    expect(eas.build.staging?.channel).toBe("staging");
    expect(eas.build.production?.channel).toBe("production");
  });

  /*
   * An `.aab` is a store upload and cannot be installed from a browser. This pilot distributes by
   * link, so every distributable profile builds an APK.
   */
  it("builds an installable APK for each distributed environment", () => {
    for (const name of ["demo", "staging", "production"]) {
      expect(eas.build[name]?.android?.buildType, name).toBe("apk");
      expect(eas.build[name]?.distribution, name).toBe("internal");
    }
  });
});

describe("the native build identity", () => {
  let demo: ExpoConfig;
  let staging: ExpoConfig;
  let production: ExpoConfig;

  beforeAll(async () => {
    demo = await manifestFor("demo");
    staging = await manifestFor("staging");
    production = await manifestFor("production");
  });

  /*
   * The decision this gate exists for (ADR-042). Android identifies an application by its package,
   * and installing the same package is an *update* that inherits the previous app's data
   * directory — its SQLCipher database, its session, and any capture it has not delivered. Two
   * environments sharing a package is therefore a route by which installing production adopts
   * staging's unsynchronised field work and points it at another server.
   */
  it("gives each environment its own package, so one install never replaces another", () => {
    const packages = [demo, staging, production].map((c) => c.android?.package);
    expect(new Set(packages).size).toBe(3);
    expect(packages.every((p) => typeof p === "string" && p.length > 0)).toBe(true);
  });

  /*
   * Staging keeps the original identifier because staging is the build that is *installed*. Giving
   * production the clean id would mean renaming staging, and a rename is a reinstall, and a
   * reinstall is the operation that discards whatever the handset is holding.
   */
  it("leaves the installed staging application exactly where it is", () => {
    expect(staging.android?.package).toBe("ec.eiastudio.field");
    expect(staging.scheme).toBe("eiafield");
  });

  it("gives each environment its own deep-link scheme", () => {
    const schemes = [demo, staging, production].map((c) => c.scheme);
    expect(new Set(schemes).size).toBe(3);
  });

  /* A technician with two icons must be able to tell them apart before opening either. */
  it("says which build it is in the launcher name", () => {
    const names = [demo, staging, production].map((c) => c.name);
    expect(new Set(names).size).toBe(3);
    expect(staging.name).toContain("Pruebas");
    expect(demo.name).toContain("Demo");
  });

  /*
   * Four codes are already spent on `ec.eiastudio.field`: EAS staging builds with **2** (24
   * September 2026) and **3** (12 October), and local builds up to **7** on the training emulator
   * on 19 November. Android refuses an install that goes backwards, and a reused code looks like
   * "the APK did not update" on somebody's phone. The two new packages start their own count.
   */
  it("uses an Android versionCode above every one already built for that package", () => {
    /*
     * Staging has spent 9: EAS builds 2, 3 and 4, local builds up to 7 on the training emulator,
     * and **9 twice** — once on 26 November morning and once that evening, because
     * `EIA_FIELD_VERSION_CODE` was passed on the command line to an EAS build, which never sees
     * it. Two different artefacts carrying one code is what this assertion exists to stop, so the
     * committed number is the authority and the floor moves with it.
     */
    expect(staging.android?.versionCode).toBeGreaterThanOrEqual(10);
    expect(demo.android?.versionCode).toBeGreaterThanOrEqual(2);
    expect(production.android?.versionCode).toBeGreaterThanOrEqual(2);
  });

  /* Three builds of one application, not three applications. Everything below is identical. */
  it.each(["demo", "staging", "production"])(
    "asks for the camera and location in %s, and for nothing else",
    async (environment) => {
      const config = await manifestFor(environment);
      expect([...(config.android?.permissions ?? [])].sort()).toEqual([
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "CAMERA",
      ]);
    },
  );

  /*
   * Without SQLCipher `PRAGMA key` silently does nothing and the answers sit in the clear while
   * the application believes otherwise (ADR-028). The runtime check exists too; this one fails
   * before a build is ever made — and now for each of the three.
   */
  it.each(["demo", "staging", "production"])(
    "keeps the encrypted database switched on in %s",
    async (environment) => {
      const config = await manifestFor(environment);
      const sqlite = config.plugins?.find(
        (p): p is [string, { useSQLCipher?: boolean }] =>
          Array.isArray(p) && p[0] === "expo-sqlite",
      );
      expect(sqlite?.[1]?.useSQLCipher).toBe(true);
    },
  );

  it.each(["demo", "staging", "production"])(
    "never reintroduces the microphone or the photo library in %s",
    async (environment) => {
      const config = await manifestFor(environment);
      const picker = config.plugins?.find(
        (p): p is [string, { microphonePermission?: unknown; photosPermission?: unknown }] =>
          Array.isArray(p) && p[0] === "expo-image-picker",
      );
      expect(picker?.[1]?.microphonePermission).toBe(false);
      // The camera, never the photo library (ADR-032).
      expect(picker?.[1]?.photosPermission).toBe(false);
    },
  );
});

/**
 * The three sources of one build have to say the same thing.
 *
 * A build's environment is written in three places — the profile in `eas.json`, the manifest from
 * `app.config.ts`, and the contract in `src/config.ts` — and the one that matters at runtime is
 * whichever the code happens to read. They had already drifted: `eas.json` and `app.config.ts`
 * admitted **demo**, and `src/config.ts` did not, so `readEnvironment("demo")` threw and the demo
 * build could not construct its auth client at all. A build that cannot start is the good failure;
 * the bad one is a build that starts and quietly reads as something else.
 *
 * So the correspondence is asserted rather than maintained by hand.
 */
describe("the profile, the manifest and the runtime contract agree", () => {
  const distributed = ["demo", "staging", "production"] as const;

  it.each(distributed)("%s is an environment the runtime contract admits", (environment) => {
    expect(APP_ENVIRONMENTS as ReadonlyArray<string>).toContain(environment);
  });

  it.each(distributed)("%s points at exactly the origin the contract names", (environment) => {
    expect(eas.build[environment]?.env?.["EXPO_PUBLIC_API_URL"]).toBe(
      ENVIRONMENT_ORIGINS[environment],
    );
  });

  it.each(distributed)("%s declares the same environment in its manifest", async (environment) => {
    const config = await manifestFor(environment);
    const extra = config.extra as { eiaEnvironment?: string } | undefined;
    expect(extra?.eiaEnvironment).toBe(environment);
  });

  it.each(distributed)("%s claims the scheme the contract assigns it", async (environment) => {
    const config = await manifestFor(environment);
    expect(config.scheme).toBe(ENVIRONMENT_SCHEMES[environment]);
  });

  /* And the three origins are three, not two with a typo. */
  it("names three distinct origins", () => {
    const origins = distributed.map((e) => ENVIRONMENT_ORIGINS[e]);
    expect(new Set(origins).size).toBe(3);
  });
});
