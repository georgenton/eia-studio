#!/usr/bin/env node
// Re-derive the self-hosted web fonts in apps/web/app/fonts from the Google Fonts API.
//
// This script is NOT part of `build`, `dev` or CI, and must never become part of them: the whole
// point of committing the files is that `next build` reaches no network (docs/DEPENDENCIES.md
// § Self-hosted fonts, docs/EIA_COOLIFY_DEPLOYMENT.md). It exists so that "where did these bytes
// come from?" has a runnable answer instead of a story.
//
//   node tooling/scripts/fetch-web-fonts.mjs          verify the committed files against upstream
//   node tooling/scripts/fetch-web-fonts.mjs --write   refresh them (review the diff, bump EXPECTED)
//
// The request reproduces what `next/font/google` did before it was removed: the same css2 URL
// (family, `wght@` list, `display`), and the same user agent, because Google serves woff2 only to
// a browser-shaped client. Google returns one *variable* woff2 per family and subset, so the
// per-weight @font-face rules all point at one file — that is why one file per family is enough,
// and why apps/web/app/layout.tsx declares the weights against it by hand.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Matches next/font/google's fetch-resource.js. A generic agent is served ttf, not woff2.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/104.0.0.0 Safari/537.36";

// family / weights / subset must stay in step with the localFont() calls in apps/web/app/layout.tsx.
// sha256 is the file as committed; a mismatch means upstream re-cut the font.
const EXPECTED = [
  {
    file: "source-serif-4-latin.woff2",
    family: "Source Serif 4",
    weights: ["400", "600"],
    subset: "latin",
    sha256: "286e05e5e444f44e50724df445808458dea58507e9805bba012b3b12d08ca122",
  },
  {
    file: "archivo-latin.woff2",
    family: "Archivo",
    weights: ["400", "500", "600"],
    subset: "latin",
    sha256: "7150c0ec5ad356453013d11affec1fbab95de0dd2dcecb043b4f1cb7f87c4ba4",
  },
  {
    file: "jetbrains-mono-latin.woff2",
    family: "JetBrains Mono",
    weights: ["400", "500"],
    subset: "latin",
    sha256: "2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4",
  },
];

const fontsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/web/app/fonts");
const write = process.argv.includes("--write");

async function get(url, accept) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return accept === "text" ? res.text() : Buffer.from(await res.arrayBuffer());
}

/** Pull the src URLs of the `@font-face` blocks Google labels with the requested subset. */
function subsetUrls(css, subset) {
  const urls = new Set();
  for (const [, label, block] of css.matchAll(/\/\* (.+?) \*\/\s*@font-face \{([\s\S]*?)\}/g)) {
    if (label !== subset) continue;
    const src = /src:\s*url\((.+?)\)/.exec(block);
    if (src) urls.add(src[1]);
  }
  return [...urls];
}

let failed = 0;
for (const font of EXPECTED) {
  const url =
    `https://fonts.googleapis.com/css2?family=${font.family.replace(/ /g, "+")}` +
    `:wght@${font.weights.join(";")}&display=swap`;
  const urls = subsetUrls(await get(url, "text"), font.subset);
  if (urls.length !== 1) {
    // More than one means Google stopped serving a single variable file per subset, and
    // layout.tsx's one-file-per-family assumption no longer holds. That is a code change.
    throw new Error(
      `${font.family}: expected 1 '${font.subset}' file, upstream now serves ${urls.length}. ` +
        `apps/web/app/layout.tsx must declare one src per file before this script can be used.`,
    );
  }
  const bytes = await get(urls[0]);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const path = join(fontsDir, font.file);

  if (write) {
    writeFileSync(path, bytes);
    console.log(`${font.file}  ${sha}  ${bytes.length} bytes  <- ${urls[0]}`);
    if (sha !== font.sha256) console.log(`  upstream changed; update EXPECTED.sha256 to ${sha}`);
    continue;
  }

  const onDisk = createHash("sha256").update(readFileSync(path)).digest("hex");
  const problems = [
    onDisk === font.sha256 ? null : `committed file is ${onDisk}, EXPECTED says ${font.sha256}`,
    sha === font.sha256 ? null : `upstream is now ${sha}`,
  ].filter(Boolean);
  if (problems.length === 0) {
    console.log(`ok  ${font.file}  ${sha}`);
  } else {
    failed += 1;
    console.error(`FAIL ${font.file}: ${problems.join("; ")}`);
  }
}

if (failed > 0) {
  console.error(
    `\n${failed} font file(s) diverge. An upstream re-cut is a design change: refresh with ` +
      `--write, re-run pnpm e2e:screenshots and compare against design/reference/.`,
  );
  process.exit(1);
}
