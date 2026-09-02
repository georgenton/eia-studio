/** Build identity for health endpoints and footers; no secrets. */
export const APP_VERSION = process.env.npm_package_version ?? "0.0.0";
export const GIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? "local";
