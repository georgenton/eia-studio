import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * What may not be in the mobile bundle (Production V1, Wave 1, Phase 2 and Phase 21).
 *
 * A React Native bundle is readable by whoever holds the phone. Two consequences shape this test.
 *
 * **Server code must not be reachable from it.** A PostgreSQL driver, Drizzle, the application
 * layer or `node:` builtins in the graph mean either a build that fails on device or, worse, a
 * shim that makes it succeed — and a shimmed `node:crypto` in a field application is a security
 * property nobody reviewed. `@eia/domain` is imported through its `./mobile` entry point for
 * exactly this reason, and `packages/domain/test/purity.test.ts` guards what that entry can reach.
 *
 * **There must be no secret in it.** The application authenticates by a session the technician
 * creates; there is no service token, no signing key and no shared credential to leak.
 */
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FORBIDDEN_IMPORTS = [
  "@eia/db",
  "@eia/application",
  "@eia/contracts",
  "drizzle-orm",
  "pg",
  "postgres",
  "next",
  "server-only",
];

/** The barrel reaches `node:crypto`; `@eia/domain/mobile` is the entry a bundle may use. */
const FORBIDDEN_EXACT = ["@eia/domain"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !full.includes(`${"test"}/`)) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/g;

function appSources(): string[] {
  return [join(APP_ROOT, "App.tsx"), ...sourceFiles(join(APP_ROOT, "src"))];
}

describe("the mobile bundle", () => {
  it("imports no server package, driver or ORM", () => {
    const offenders: string[] = [];
    for (const file of appSources()) {
      for (const match of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
        const specifier = match[1]!;
        if (
          FORBIDDEN_IMPORTS.some((f) => specifier === f || specifier.startsWith(`${f}/`)) ||
          FORBIDDEN_EXACT.includes(specifier)
        ) {
          offenders.push(`${file.replace(APP_ROOT, "apps/field")} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("imports no Node builtin", () => {
    const offenders: string[] = [];
    for (const file of appSources()) {
      for (const match of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
        if (match[1]!.startsWith("node:")) {
          offenders.push(`${file.replace(APP_ROOT, "apps/field")} → ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares only platform-safe workspace dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const workspace = Object.keys(manifest.dependencies).filter((name) => name.startsWith("@eia/"));
    expect(workspace.sort()).toEqual(["@eia/domain", "@eia/field-sync-contract"]);
  });

  it("carries no secret: nothing in the source looks like a key or a token", () => {
    // Not a scanner — a tripwire for the specific mistake of pasting a credential into a client
    // that a technician's phone will hold for ever.
    const suspicious =
      /(?:secret|api[_-]?key|service[_-]?token|private[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_-]{12,}/i;
    const offenders = appSources().filter((file) => suspicious.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
