import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

/** Load the repository-root .env for scripts run through `pnpm --filter @eia/db`. */
export function loadDotenv(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const file = resolve(root, ".env");
  if (existsSync(file)) config({ path: file, quiet: true });
}
