#!/usr/bin/env node
// Drift check: `drizzle-kit generate` must produce no new migration when schema and migrations
// agree. Runs in CI (docs/CI.md Stage C). Exits non-zero if a new file would be created.
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(pkg, "migrations");
const before = new Set(readdirSync(dir));
execSync("pnpm exec drizzle-kit generate --name drift_check", { cwd: pkg, stdio: "pipe" });
const after = readdirSync(dir).filter((f) => !before.has(f));
if (after.length > 0) {
  console.error(`schema drift detected: drizzle-kit would create ${after.join(", ")}`);
  console.error(
    "Run `pnpm db:generate`, review the SQL, and commit it (or revert the schema change).",
  );
  execSync("git checkout -- migrations/meta && git clean -fdq migrations", { cwd: pkg });
  process.exit(1);
}
console.log("migrations: no drift");
