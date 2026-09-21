/**
 * `expo export` exits 0 even when it bundled nothing.
 *
 * On 21 September 2026 the first EAS build failed at `createBundleReleaseJsAndAssets` with
 * `Cannot find module 'babel-preset-expo'`: the preset `apps/field/babel.config.js` names was
 * declared in no package.json, so pnpm — which links only what is declared — never placed it where
 * Babel could find it. The same failure had been happening locally for some time, and nobody saw
 * it: `pnpm bundle` printed `Files (1): metadata.json (150B)`, exited **0**, and was read as a
 * passing gate. A bundle of zero modules is not a smaller bundle; it is no application at all.
 *
 * So the gate now asserts the artefact rather than the exit code: every requested platform must
 * have produced a JavaScript bundle of a plausible size. A bundle that is missing, or suspiciously
 * small, fails here instead of four minutes into a native build — or, worse, on a technician's
 * phone.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Below this, whatever was written is not this application. The real bundle is ~2.9 MB. */
const MIN_BUNDLE_BYTES = 500_000;

const outDir = process.argv[2] ?? ".expo-export";
const platforms = process.argv.slice(3);
if (platforms.length === 0) platforms.push("android", "ios");

const problems = [];

for (const platform of platforms) {
  const dir = join(outDir, "_expo", "static", "js", platform);
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    problems.push(
      `${platform}: no bundle directory at ${dir} — expo export produced no JavaScript`,
    );
    continue;
  }
  const bundles = entries.filter((name) => name.endsWith(".hbc") || name.endsWith(".js"));
  if (bundles.length === 0) {
    problems.push(`${platform}: ${dir} contains no .hbc or .js bundle`);
    continue;
  }
  const largest = Math.max(...bundles.map((name) => statSync(join(dir, name)).size));
  if (largest < MIN_BUNDLE_BYTES) {
    problems.push(
      `${platform}: largest bundle is ${largest} bytes, under the ${MIN_BUNDLE_BYTES} floor — ` +
        `this is what an export looks like when the Babel preset cannot be resolved`,
    );
    continue;
  }
  console.log(
    `${platform}: ${bundles.length} bundle(s), largest ${(largest / 1_048_576).toFixed(1)} MB`,
  );
}

if (problems.length > 0) {
  console.error("\nexpo export produced no usable bundle:\n");
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
