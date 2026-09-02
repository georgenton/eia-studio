import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `@eia/ui` holds visual primitives and must not couple the design system to a framework's
 * routing (IG1-004, TD-024 resolved). Components that construct routes or drive the router are
 * application navigation and live in `apps/web/components/navigation`.
 *
 * React is allowed and declared as a peer dependency; a router is not.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const FORBIDDEN = [/from ["']next\//, /from ["']next["']/, /from ["']react-router/, /useRouter\(/];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("@eia/ui stays framework-agnostic", () => {
  const files = sources(SRC);

  it("has sources to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("imports no router from any component", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(text), `${file} matches ${pattern}`).toBe(false);
      }
    }
  });

  it("declares no framework in its manifest", () => {
    const manifest = JSON.parse(readFileSync(resolve(SRC, "../package.json"), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const field of ["dependencies", "peerDependencies", "devDependencies"]) {
      expect(Object.keys(manifest[field] ?? {}), field).not.toContain("next");
    }
  });
});
