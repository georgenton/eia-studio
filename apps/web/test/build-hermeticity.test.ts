import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `next build` must not need the network.
 *
 * `next/font/google` downloads the font files from `fonts.gstatic.com` while the build runs. When
 * the build host cannot reach it, Next still emits the generated font CSS module and the build
 * then fails resolving files it never fetched — which is what took the container gate of PR #57
 * down, after the same failure had been seen once locally and recorded as not reproduced
 * (docs/EIA_COOLIFY_DEPLOYMENT.md). The fonts are committed under `app/fonts` and loaded through
 * `next/font/local` instead.
 *
 * The regression this guards against is not a broken build — it is somebody adding one import
 * back, the CI runner happening to have the network, and the failure surfacing in a deployment
 * instead. Hermeticity is cheap to assert and expensive to rediscover.
 */
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONTS_DIR = join(APP_ROOT, "app/fonts");

/**
 * Loaders that resolve their assets over the network at build time, matched where they are
 * *loaded* rather than merely mentioned — `app/layout.tsx` names `next/font/google` in the comment
 * that explains why it no longer imports it, and a substring search would fail on the explanation.
 */
const NETWORK_FONT_LOADER = /(?:from|import|require)\s*\(?\s*["'](?:@next|next)\/font\/google["']/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx?|mts|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the web build reaches no network for fonts", () => {
  it("imports no font loader that downloads at build time", () => {
    const offenders = sourceFiles(APP_ROOT)
      .filter((file) => NETWORK_FONT_LOADER.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(APP_ROOT.length + 1))
      // This file carries the pattern in order to forbid it.
      .filter((file) => file !== join("test", "build-hermeticity.test.ts"));

    expect(offenders).toEqual([]);
  });

  /**
   * One woff2 per family, and its licence beside it. Google serves a single *variable* file per
   * family and subset, so the per-weight faces in `app/layout.tsx` all point at one file; a second
   * file appearing for a family means that assumption changed and the declarations must too.
   *
   * The hashes are the ones `tooling/scripts/fetch-web-fonts.mjs` verifies against upstream. Here
   * they only pin what is committed: a font file swapped in this repository is a change to what
   * every screen renders, and it should fail a test rather than be noticed in a screenshot diff.
   */
  it("ships exactly the three font files the layout declares, with their licences", () => {
    const expected = {
      "source-serif-4-latin.woff2":
        "286e05e5e444f44e50724df445808458dea58507e9805bba012b3b12d08ca122",
      "archivo-latin.woff2": "7150c0ec5ad356453013d11affec1fbab95de0dd2dcecb043b4f1cb7f87c4ba4",
      "jetbrains-mono-latin.woff2":
        "2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4",
    };

    const present = readdirSync(FONTS_DIR).sort();
    expect(present).toEqual([
      "archivo-OFL.txt",
      "archivo-latin.woff2",
      "jetbrains-mono-OFL.txt",
      "jetbrains-mono-latin.woff2",
      "source-serif-4-OFL.txt",
      "source-serif-4-latin.woff2",
    ]);

    for (const [file, sha256] of Object.entries(expected)) {
      const bytes = readFileSync(join(FONTS_DIR, file));
      expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(sha256);
      // A woff2 always starts with the `wOF2` signature; a stray .ttf or an HTML error page
      // saved by a redirect would load as nothing and fall back silently.
      expect(bytes.subarray(0, 4).toString("ascii"), file).toBe("wOF2");
    }
  });

  it("carries the SIL Open Font License beside every font", () => {
    for (const licence of readdirSync(FONTS_DIR).filter((f) => f.endsWith("-OFL.txt"))) {
      const text = readFileSync(join(FONTS_DIR, licence), "utf8");
      expect(text, licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
  });

  /**
   * The families, weights and CSS variables the approved design bundle specifies (design v0.2,
   * `packages/ui/src/tokens.css`). Switching loader changed how the faces are declared; it must
   * not have changed which faces exist.
   */
  it("declares the approved families, weights and variables", () => {
    const layout = readFileSync(join(APP_ROOT, "app/layout.tsx"), "utf8");
    const face = (file: string, weight: string) =>
      `{ path: "./fonts/${file}", weight: "${weight}", style: "normal" }`;

    for (const [file, weights] of [
      ["source-serif-4-latin.woff2", ["400", "600"]],
      ["archivo-latin.woff2", ["400", "500", "600"]],
      ["jetbrains-mono-latin.woff2", ["400", "500"]],
    ] as const) {
      for (const weight of weights) expect(layout).toContain(face(file, weight));
    }

    for (const variable of [
      "--eia-font-serif-loaded",
      "--eia-font-sans-loaded",
      "--eia-font-mono-loaded",
    ]) {
      expect(layout).toContain(`variable: "${variable}"`);
    }
  });
});
