import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The four places that have to agree before a published image can read a PDF.
 *
 * `apps/worker/src/pdf-smoke.ts` is what actually proves it, inside the built image, in CI. This
 * file is the cheap half: it fails in the unit suite, in a second, when one of the four moves
 * without the others — which is how the defect of 1 October 2026 happened. pdf.js was bundled,
 * so its worker module and its native canvas dependency were expected beside a generated chunk;
 * neither was there; and nothing anywhere said those three facts were related.
 *
 * It asserts the *coupling*, not the behaviour. If pdf.js stops needing a canvas package, delete
 * this file and the dependency together — the image smoke will keep the honest answer.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

interface Manifest {
  readonly dependencies?: Record<string, string>;
}

const worker = JSON.parse(read("apps/worker/package.json")) as Manifest;
const application = JSON.parse(read("packages/application/package.json")) as Manifest;
const tsup = read("apps/worker/tsup.config.ts");
const dockerfile = read("Dockerfile");

/** The two packages pdf.js needs on disk at runtime, which esbuild cannot inline. */
const RUNTIME_PACKAGES = ["pdfjs-dist", "@napi-rs/canvas"] as const;

describe("PDF extraction is packaged into the image, not only into the workspace", () => {
  it.each(RUNTIME_PACKAGES)(
    "declares %s explicitly in the package that extracts, at an exact version",
    (name) => {
      const version = application.dependencies?.[name];
      expect(version, `${name} must be a dependency of @eia/application`).toBeDefined();
      // Exact, because one of these carries a compiled binary and a caret would let a build pick
      // a different one (docs/DEPENDENCIES.md).
      expect(version).toMatch(/^\d+\.\d+\.\d+$/u);
    },
  );

  it.each(RUNTIME_PACKAGES)("declares %s in the worker, which externalizes it", (name) => {
    // The same reason `pg` and `pino` are there: the bundle does not carry it, so the process
    // that runs the bundle has to resolve it.
    expect(worker.dependencies?.[name]).toBe(application.dependencies?.[name]);
  });

  it.each(RUNTIME_PACKAGES)("keeps %s out of the worker bundle", (name) => {
    const externals = /external:\s*\[([^\]]*)\]/u.exec(tsup)?.[1] ?? "";
    expect(externals).toContain(`"${name}"`);
    expect(tsup).not.toContain(`noExternal: ["${name}"`);
  });

  it("ships pdf.js's own layout into the runtime image", () => {
    // Staged in the build stage, because pnpm's node_modules are symlinks into .pnpm and
    // `COPY --from` does not follow one out of the tree it is copying.
    expect(dockerfile).toContain("/pdf-runtime");
    expect(dockerfile).toContain(
      "COPY --from=build --chown=node:node /pdf-runtime/ ./node_modules/",
    );
    // The two files whose absence was the defect, named in the Dockerfile's own assertions.
    expect(dockerfile).toContain("/pdf-runtime/pdfjs-dist/legacy/build/pdf.mjs");
    expect(dockerfile).toContain("/pdf-runtime/pdfjs-dist/legacy/build/pdf.worker.mjs");
  });

  it("imports pdf.js during the build, so a wrong-architecture binary fails there", () => {
    expect(dockerfile).toContain("import('pdfjs-dist/legacy/build/pdf.mjs')");
  });

  it("asks the built image itself, in CI, before any digest is published", () => {
    const action = read(".github/actions/build-eia-image/action.yml");
    expect(action).toContain("apps/worker/dist/pdf-smoke.js");
    expect(action).toContain('"ok":true');
  });
});
