import { defineConfig } from "tsup";

// Bundles the worker with its workspace packages into one ESM file; native deps stay external.
export default defineConfig({
  entry: ["src/main.ts"],
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
  external: ["pg", "pino", "pg-native"],
  /*
   * An ESM bundle carrying CommonJS dependencies needs a real `require`; esbuild's shim throws
   * `Dynamic require of "..." is not supported`. Same reasoning as packages/db/tsup.config.ts.
   */
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
