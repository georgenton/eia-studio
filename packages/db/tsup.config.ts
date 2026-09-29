import { defineConfig } from "tsup";

/**
 * Compiles the migration runner so the runtime image never ships a development toolchain.
 *
 * `pnpm db:migrate` runs `scripts/migrate.ts` through tsx, which is right for a developer and
 * wrong for a container: shipping tsx to run one script drags TypeScript into the runtime layer.
 * The bundle keeps the same shape the source has, and that matters more than it looks —
 * `MIGRATIONS_FOLDER` is `resolve(dirname(import.meta.url), "../migrations")`, so emitting to
 * `dist/` keeps `../migrations` pointing at `packages/db/migrations` exactly as before. The image
 * copies that folder beside the bundle and the path resolves without a special case.
 */
export default defineConfig({
  entry: { migrate: "scripts/migrate.ts" },
  format: ["esm"],
  target: "node24",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Named one by one, and the list is the result of running the binary rather than reading the
  // config. tsup externalises a package's declared `dependencies` by default, so `zod` and
  // `drizzle-orm` were left out and the container died on `Cannot find package 'zod'`. The
  // obvious fix — `noExternal: [/.*/]` — is wrong: `noExternal` wins over `external`, so it
  // swallowed `pg` too, and pg is CommonJS with dynamic `require("events")` that no bundler can
  // resolve. `pg` and `pg-native` must stay outside; everything else comes in.
  noExternal: ["@eia/contracts", "drizzle-orm", "zod"],
  external: ["pg", "pg-native"],
  /*
   * An ESM bundle that contains CommonJS dependencies needs a real `require`. esbuild otherwise
   * substitutes a shim that throws `Dynamic require of "fs" is not supported`, which is how
   * `dotenv` took the container down on the third attempt — `loadDotenv()` runs before anything
   * else in the entry. Handing the bundle `createRequire` fixes the whole class of problem rather
   * than the one dependency that happened to surface it.
   */
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
