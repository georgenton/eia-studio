import { defineConfig } from "tsup";

// Bundles the worker with its workspace packages into one ESM file; native deps stay external.
export default defineConfig({
  // `pdf-smoke.ts` is a second entry on purpose: it is the one way to ask a *built image* whether
  // it can read a PDF, which is the question CI now has to answer before publishing a digest.
  // A few kilobytes beside `main.js`, reachable only by running it. `image-smoke.ts` is the same
  // question about sharp, whose native binary the published photograph path depends on and which
  // no test in this workspace resolves the way the artefact does.
  entry: ["src/main.ts", "src/pdf-smoke.ts", "src/image-smoke.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Every workspace package the entry reaches, not just the three that were listed. `main.ts`
  // imports `@eia/application` too, and leaving it out produced a binary that only ran inside the
  // workspace — the container died on `Cannot find package '@eia/application'`. Found by running
  // the image, which is the only place the omission shows.
  noExternal: ["@eia/application", "@eia/contracts", "@eia/db", "@eia/domain"],
  /*
   * `pdfjs-dist` is external, and that is a decision rather than an omission.
   *
   * Bundled, esbuild turned `await import("pdfjs-dist/legacy/build/pdf.mjs")` into a hashed chunk
   * in `dist/`, and pdf.js then looked for the two things it loads at runtime **next to that
   * chunk**: `pdf.worker.mjs`, which it imports to set up its fake worker, and `@napi-rs/canvas`,
   * which it requires to polyfill `DOMMatrix`. Neither was there, so extraction failed in the
   * published image while passing every test in this workspace.
   *
   * External, pdf.js keeps its own layout: `pdf.mjs` and `pdf.worker.mjs` are siblings in
   * `node_modules/pdfjs-dist/legacy/build/`, and the canvas package is its declared dependency.
   * Nothing has to know a generated chunk's name, and the Dockerfile ships one directory.
   */
  /*
   * `sharp` joins them for the same reason, and the worker never calls it: publishing a
   * photograph happens in the web process. A static import put it in this bundle and the built
   * worker then refused to start over a native library it has no use for — the pdf.js defect
   * again, caught this time by `pnpm --filter @eia/worker build` instead of by a deployment.
   * `packages/application/src/portal/editorial-image.ts` loads it dynamically, so with this entry
   * the worker's graph never reaches the import.
   */
  external: ["pg", "pino", "pg-native", "pdfjs-dist", "@napi-rs/canvas", "sharp"],
  /*
   * An ESM bundle carrying CommonJS dependencies needs a real `require`; esbuild's shim throws
   * `Dynamic require of "..." is not supported`. Same reasoning as packages/db/tsup.config.ts.
   */
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
