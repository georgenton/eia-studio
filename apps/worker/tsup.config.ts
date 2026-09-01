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
  noExternal: ["@eia/contracts", "@eia/db", "@eia/domain"],
  external: ["pg", "pino", "pg-native"],
});
