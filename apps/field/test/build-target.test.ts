import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
  build: Record<string, { env?: Record<string, string>; channel?: string }>;
};
const app = JSON.parse(readFileSync(resolve(here, "../app.json"), "utf8")) as {
  expo: { android: { versionCode: number; permissions: string[] }; plugins: unknown[] };
};

const STAGING_HOST = "https://vih786wuduzmldekoq3zdies.syntavera.dev";

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
    expect(eas.build.staging?.env?.["EXPO_PUBLIC_APP_ENV"]).toBe("staging");
    expect(eas.build.production?.env?.["EXPO_PUBLIC_APP_ENV"]).toBe("production");
  });

  /* The production profile is a separate thing and this gate does not touch it. */
  it("leaves production on its own host and channel", () => {
    expect(eas.build.production?.env?.["EXPO_PUBLIC_API_URL"]).not.toBe(STAGING_HOST);
    expect(eas.build.production?.channel).toBe("production");
    expect(eas.build.staging?.channel).toBe("staging");
  });
});

describe("the native build identity", () => {
  /*
   * Two codes are already spent: an EAS staging build finished with **2** on 24 September 2026 and
   * another with **3** on 12 October. Android refuses an install that goes backwards, and a reused
   * code is the kind of thing that looks like "the APK did not update" on somebody's phone.
   */
  it("uses an Android versionCode above every one already built", () => {
    expect(app.expo.android.versionCode).toBeGreaterThanOrEqual(4);
  });

  it("asks for the camera and location, and for nothing else", () => {
    expect([...app.expo.android.permissions].sort()).toEqual([
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "CAMERA",
    ]);
  });

  /*
   * Without SQLCipher `PRAGMA key` silently does nothing and the answers sit in the clear while
   * the application believes otherwise (ADR-028). The runtime check exists too; this one fails
   * before a build is ever made.
   */
  it("keeps the encrypted database switched on", () => {
    const sqlite = app.expo.plugins.find(
      (p): p is [string, { useSQLCipher?: boolean }] => Array.isArray(p) && p[0] === "expo-sqlite",
    );
    expect(sqlite?.[1]?.useSQLCipher).toBe(true);
  });

  it("never reintroduces the microphone", () => {
    const picker = app.expo.plugins.find(
      (p): p is [string, { microphonePermission?: unknown; photosPermission?: unknown }] =>
        Array.isArray(p) && p[0] === "expo-image-picker",
    );
    expect(picker?.[1]?.microphonePermission).toBe(false);
    // The camera, never the photo library (ADR-032).
    expect(picker?.[1]?.photosPermission).toBe(false);
  });
});
