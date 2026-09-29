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
  /*
   * Standalone output is a **container** concern, and only a container's.
   *
   * It emits a self-contained server with only the traced dependencies, which is what lets the
   * runtime image carry no pnpm store, no workspace symlinks and no build toolchain. But Vercel
   * produces its own output format and traces files its own way: with `output: "standalone"` its
   * `onBuildComplete` hook fails on a missing `.next/next-server.js.nft.json`, which took the
   * preview deployment of this very change down. Vercel is where staging runs today.
   *
   * So the switch is the build target, set by the Dockerfile, rather than a global default.
   * Every other consumer — Vercel, `pnpm dev`, `pnpm build`, the e2e suite — keeps the output
   * it had before this file changed.
   */
  ...(process.env.NEXT_OUTPUT === "standalone"
    ? {
        output: "standalone" as const,
        // In a pnpm workspace the trace must start at the repository root, or Next resolves the
        // workspace packages and the virtual store relative to apps/web and leaves them out.
        outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
      }
    : {}),
};

export default nextConfig;
