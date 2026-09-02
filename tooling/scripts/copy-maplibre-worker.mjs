#!/usr/bin/env node
// Copy MapLibre's worker bundle into apps/web/public so the browser can load it as a real module.
//
// MapLibre parses GeoJSON in a web worker. The worker it ships (`maplibre-gl-worker.mjs`) imports
// a sibling module by relative path (`./maplibre-gl-shared.mjs`). Next emits the worker as a
// content-hashed asset but not its sibling, so the import 404s and the worker never completes its
// handshake — sources stay unloaded and the map paints nothing, with no error. Serving both files
// side by side from /public keeps the relative import intact.
//
// Generated output; not committed. Run by `predev` and `prebuild`.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRoot = join(repoRoot, "apps/web");
const pkgPath = require.resolve("maplibre-gl/package.json", { paths: [webRoot] });
const dist = join(dirname(pkgPath), "dist");
const version = JSON.parse(readFileSync(pkgPath, "utf8")).version;

const out = join(webRoot, "public/vendor/maplibre");
mkdirSync(out, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, file), join(out, file));
}
console.log(`maplibre worker ${version} copied to public/vendor/maplibre`);
