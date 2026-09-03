import type { AppEnvironment } from "@eia/contracts";

/**
 * Which origins Better Auth may accept a state-changing request from.
 *
 * ## The bug this exists to fix
 *
 * A Vercel deployment answers on **two** hostnames: its immutable per-deployment URL
 * (`VERCEL_URL`, e.g. `eia-studio-5ftqg28xs-…vercel.app`) and the stable per-branch alias
 * (`VERCEL_BRANCH_URL`, e.g. `eia-studio-web-git-main-…vercel.app`). Our environment derived
 * `BETTER_AUTH_URL` from the *branch* alias, and Better Auth's trusted set is the origin of its
 * `baseURL` plus whatever `trustedOrigins` lists (verified in `getTrustedOrigins`,
 * better-auth 1.7.2). `AUTH_TRUSTED_ORIGINS` is unset on Preview, so exactly one origin was
 * trusted — and a reviewer opening the deployment URL posted from the other one:
 *
 *     POST /api/auth/sign-in/email → 403
 *     Invalid origin: https://eia-studio-5ftqg28xs-georgentons-projects.vercel.app
 *
 * The correction is to trust **both of this deployment's own origins**, whichever one the base URL
 * happens to be derived from.
 *
 * ## What is deliberately not done
 *
 * No `disableOriginCheck`, no `disableCSRFCheck`, and no `https://*.vercel.app` pattern. A wildcard
 * over a shared platform domain would trust every other tenant of that domain — `.vercel.app` is
 * not a trust boundary, it is a landlord. Every origin here is either configured by us or handed to
 * this process by the platform as *this project's own* hostname.
 *
 * Loopback origins are accepted only in `local` and `test`. A staging or production deployment that
 * still carried `http://localhost:3000` in its configuration would be trusting any process on the
 * reviewer's machine, so the environment drops it rather than honouring it.
 */
export interface TrustedOriginInput {
  /** Explicitly configured origins (`AUTH_TRUSTED_ORIGINS`), highest intent. */
  readonly configured: readonly string[];
  /** The resolved Better Auth base URL; its origin must be trusted. */
  readonly baseURL: string;
  /** The product's public URL when pinned explicitly. */
  readonly publicAppUrl?: string | undefined;
  /** Platform-provided hostnames, scheme-less, as Vercel supplies them. */
  readonly vercel: {
    readonly deploymentHost?: string | undefined;
    readonly branchHost?: string | undefined;
    readonly productionHost?: string | undefined;
  };
  readonly appEnv: AppEnvironment;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * A scheme-less host from the platform (`VERCEL_URL` and friends) turned into an https origin.
 *
 * Rejects anything that is not purely a host: a value carrying a scheme, a path, credentials,
 * whitespace or a wildcard is configuration we do not understand, and guessing at it is how
 * `https://undefined` ends up in an allowlist.
 */
function originFromPlatformHost(host: string | undefined): string | null {
  if (!host) return null;
  const value = host.trim();
  if (value === "" || value === "undefined" || value === "null") return null;
  if (/[\s/*\\@]/.test(value) || value.includes("://")) return null;
  return toOrigin(`https://${value}`);
}

/** A full URL reduced to its origin, or null when it is not one we can accept. */
function toOrigin(candidate: string | undefined): string | null {
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // Credentials in an origin are always a mistake and would be silently dropped by `.origin`.
  if (url.username !== "" || url.password !== "") return null;
  if (url.hostname === "" || url.hostname.includes("*")) return null;
  return url.origin;
}

function isLoopback(origin: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * Build the final list: validated, deduplicated, order-stable.
 *
 * Order is intent-first (explicit configuration, then this deployment's own URLs) so that a human
 * reading the resolved list in a log sees what was asked for before what was inferred.
 */
export function resolveTrustedOrigins(input: TrustedOriginInput): string[] {
  const allowLoopback = input.appEnv === "local" || input.appEnv === "test";

  const candidates: Array<string | null> = [
    ...input.configured.map(toOrigin),
    toOrigin(input.publicAppUrl),
    toOrigin(input.baseURL),
    originFromPlatformHost(input.vercel.deploymentHost),
    originFromPlatformHost(input.vercel.branchHost),
    originFromPlatformHost(input.vercel.productionHost),
  ];

  const seen = new Set<string>();
  const origins: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!allowLoopback && isLoopback(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    origins.push(candidate);
  }
  return origins;
}

/** Read the platform hostnames from an environment, without interpreting them. */
export function vercelHosts(source: NodeJS.ProcessEnv): TrustedOriginInput["vercel"] {
  return {
    deploymentHost: source.VERCEL_URL,
    branchHost: source.VERCEL_BRANCH_URL,
    productionHost: source.VERCEL_PROJECT_PRODUCTION_URL,
  };
}
