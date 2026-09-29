import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import type { NextConfig } from "next";

// Local development reads the repository-root .env (Next only reads apps/web/.env by itself).
// Hosted environments inject variables directly; a missing file is fine.
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@eia/domain", "@eia/db", "@eia/contracts", "@eia/ui"],
  serverExternalPackages: ["pg", "pino"],
  poweredByHeader: false,
  // Container builds: emit a self-contained server with only the traced dependencies, so the
  // runtime image carries no pnpm store, no workspace symlinks and no build toolchain.
  output: "standalone",
  // In a pnpm workspace the trace must start at the repository root, or Next resolves the
  // workspace packages and the virtual store relative to apps/web and silently leaves them out.
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
};

export default nextConfig;
