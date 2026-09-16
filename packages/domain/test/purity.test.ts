import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * ADR-015 / IG0-B02: `packages/domain` is pure. It must not import a persistence adapter, a
 * driver or an ORM, and must not declare them as dependencies. ESLint enforces the same rule;
 * this test makes the boundary fail the unit suite too, independently of lint configuration.
 */
const DOMAIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN_IMPORTS = [
  "@eia/db",
  "@eia/application",
  "drizzle-orm",
  "pg",
  "postgres",
  "better-auth",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/g;

describe("domain purity", () => {
  it("no source file imports a persistence adapter, driver or ORM", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(DOMAIN_ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(IMPORT_RE)) {
        const specifier = match[1]!;
        if (FORBIDDEN_IMPORTS.some((f) => specifier === f || specifier.startsWith(`${f}/`))) {
          offenders.push(`${file.replace(DOMAIN_ROOT, "packages/domain")} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares no persistence dependency in its manifest", () => {
    const manifest = JSON.parse(readFileSync(join(DOMAIN_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const declared = Object.keys(manifest.dependencies ?? {});
    expect(declared).toEqual(["zod"]);
  });

  /**
   * The bundle-safety half of purity (Production V1, Wave 1).
   *
   * `pure` and `bundle-safe` are not the same property: `documents/chunking.ts` imports
   * `node:crypto`, which is right on a server and unresolvable in a React Native bundle. EIA Field
   * therefore imports `@eia/domain/mobile`, and this test walks that entry point's own import
   * graph so the guarantee is checked rather than remembered.
   */
  it("nothing reachable from the mobile entry point imports a Node builtin", () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(IMPORT_RE)) {
        const specifier = match[1]!;
        if (specifier.startsWith("node:")) {
          offenders.push(`${file.replace(DOMAIN_ROOT, "packages/domain")} → ${specifier}`);
          continue;
        }
        if (!specifier.startsWith(".")) continue;
        const resolved = resolve(dirname(file), specifier);
        for (const candidate of [`${resolved}.ts`, join(resolved, "index.ts")]) {
          try {
            if (statSync(candidate).isFile()) {
              visit(candidate);
              break;
            }
          } catch {
            // Not this candidate; try the next shape.
          }
        }
      }
    };
    visit(join(DOMAIN_ROOT, "src", "mobile.ts"));
    expect(offenders).toEqual([]);
    // Proof the walk actually walked: the entry alone would be one file.
    expect(seen.size).toBeGreaterThan(4);
  });

  it("is importable without any database environment or driver", async () => {
    const domain = await import("../src/index");
    expect(domain.CAPABILITY_KEYS).toHaveLength(14);
    expect(domain.TENANT_ROLES).toContain("OWNER");
  });
});
