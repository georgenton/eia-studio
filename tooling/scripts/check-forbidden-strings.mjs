#!/usr/bin/env node
// CLAUDE.md rule 3: pilot-project constants never appear in reusable code.
// Scans apps/ and packages/ (or the staged files passed by lint-staged) for forbidden strings.
// Fixtures, docs and the design bundle are out of scope by construction.
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["apps", "packages"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage", ".turbo"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".sql", ".json", ".css"]);

// Names and figures of the pilot study (DEMO_ZAMORA.md). Numbers are checked as whole tokens
// with their approved units to avoid false positives on unrelated arithmetic.
const FORBIDDEN = [
  /Zamora/i,
  /Puente del Amor/i,
  /Los Hachos/i,
  /Consultora Andina/i,
  /PRED-ZAM/,
  /\b7[,.]4\s*km\b/i,
  /\b141\s+predios\b/i,
  /\b119\s+(levantamientos|encuestas)\b/i,
  /\b185\s+participantes\b/i,
  /\broad_eia_social\b/, // profile key lives in fixtures/domain profile registry only
];
// The profile key is allowed exactly where the profile registry declares it.
const ALLOWLIST = [/packages\/domain\/src\/core\/profiles\//, /\.test\.ts$/];

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if ([...EXTENSIONS].some((ext) => entry.endsWith(ext))) out.push(full);
  }
}

function stagedFiles() {
  const out = execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" });
  return out
    .split("\n")
    .filter(Boolean)
    .map((f) => join(ROOT, f))
    .filter((f) => SCAN_DIRS.some((d) => relative(ROOT, f).split(sep)[0] === d));
}

const staged = process.argv.includes("--staged");
const files = [];
if (staged) files.push(...stagedFiles());
else
  for (const d of SCAN_DIRS) {
    try {
      if (statSync(join(ROOT, d)).isDirectory()) walk(join(ROOT, d), files);
    } catch {
      /* directory may not exist yet */
    }
  }

let failures = 0;
for (const file of files) {
  const rel = relative(ROOT, file);
  if (ALLOWLIST.some((re) => re.test(rel))) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, i) => {
    for (const re of FORBIDDEN) {
      if (re.test(line)) {
        failures++;
        console.error(`${rel}:${i + 1}: forbidden pilot constant ${re} — move it to fixtures/`);
      }
    }
  });
}

if (failures > 0) {
  console.error(`\n${failures} forbidden string(s) found (CLAUDE.md rule 3).`);
  process.exit(1);
}
console.log(`forbidden-strings: ok (${files.length} files scanned)`);
