import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The versions this application pins are the ones its Expo SDK actually ships with.
 *
 * This test exists because getting it wrong is easy and the symptom is misleading. Asking npm for
 * `latest` gave React Native **0.87.1**, which is a perfectly real release and is *not* the pairing
 * Expo SDK 57 was built against (**0.86.3**). The build failed deep inside `@expo/metro-config`,
 * requiring a file React Native had removed — a stack trace that says nothing about versions.
 *
 * `expo/bundledNativeModules.json` is the SDK's own statement of what it was built against, so it
 * is the authority here rather than a number somebody copied into a document.
 */
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

interface Manifest {
  readonly dependencies: Record<string, string>;
}

function bundled(): Record<string, string> {
  const entry = require.resolve("expo/package.json", { paths: [APP_ROOT] });
  return JSON.parse(
    readFileSync(join(dirname(entry), "bundledNativeModules.json"), "utf8"),
  ) as Record<string, string>;
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as Manifest;
}

/** `~57.0.3` and `57.0.3` are the same intent; this app pins exactly, the SDK states a range. */
function satisfies(pinned: string, declared: string): boolean {
  return pinned === declared.replace(/^[~^]/, "");
}

describe("EIA Field tracks its Expo SDK", () => {
  it("pins the React Native and React versions the SDK was built against", () => {
    const sdk = bundled();
    const deps = manifest().dependencies;
    expect(deps["react-native"], "react-native").toBe(sdk["react-native"]);
    expect(deps["react"], "react").toBe(sdk["react"]);
  });

  it("pins every Expo module at the version the SDK ships", () => {
    const sdk = bundled();
    const deps = manifest().dependencies;
    const drifted: string[] = [];
    for (const [name, pinned] of Object.entries(deps)) {
      const declared = sdk[name];
      if (!declared) continue;
      if (!satisfies(pinned, declared)) drifted.push(`${name}: pinned ${pinned}, SDK ${declared}`);
    }
    expect(drifted).toEqual([]);
  });

  it("pins exact versions, never a range", () => {
    const loose = Object.entries(manifest().dependencies)
      .filter(([name]) => !name.startsWith("@eia/"))
      .filter(([, version]) => /^[~^><*]/.test(version));
    expect(loose).toEqual([]);
  });
});
