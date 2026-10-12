import Constants from "expo-constants";

/**
 * Where this build talks to, and the one rule about it: **there is no secret here.**
 *
 * A mobile bundle is readable by whoever holds the device, so everything in it is public by
 * construction. The API base URL is public information; a signing key or a service token would
 * not be, which is why neither exists in this application and why authentication is a session the
 * technician creates by signing in.
 *
 * Staging and production are separated by build-time configuration (`EXPO_PUBLIC_API_URL`), not by
 * a runtime switch a technician could flip: a field application that can be pointed at another
 * environment from its own settings screen is one tap away from writing demo answers into a real
 * study.
 */
const FALLBACK = "http://localhost:3000";

/**
 * Which environment this build is, **declared** rather than guessed from the host.
 *
 * It used to be inferred: `localhost` → development, `vercel.app` → test, **anything else →
 * "Producción"**. That held exactly as long as the test backend lived on Vercel. The moment
 * staging moved to its own host, the same build that pointed at staging would have told the
 * technician it was production — and the person most likely to believe that label is the one
 * about to type a household's answers into it.
 *
 * So the environment is now a build input beside the URL, and the two are checked against each
 * other below. It is not a secret: it is one word, in a bundle that is public anyway.
 */
export const APP_ENVIRONMENTS = ["local", "staging", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

const LABELS: Record<AppEnvironment, string> = {
  local: "Desarrollo local",
  staging: "STAGING · Entorno de pruebas",
  production: "Producción",
};

export class MisconfiguredFieldBuild extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MisconfiguredFieldBuild";
  }
}

export interface FieldConfig {
  readonly apiBaseUrl: string;
  readonly appVersion: string;
  readonly environment: AppEnvironment;
  readonly environmentLabel: string;
}

function readEnvironment(value: string | undefined): AppEnvironment {
  const declared = value?.trim();
  if (declared === undefined || declared.length === 0) return "local";
  if ((APP_ENVIRONMENTS as ReadonlyArray<string>).includes(declared)) {
    return declared as AppEnvironment;
  }
  // A typo loses the build, not the labelling. An unknown word must never read as "Producción",
  // and must never quietly pass for staging either (IG4-001's rule, one layer across).
  throw new MisconfiguredFieldBuild(
    `EXPO_PUBLIC_APP_ENV is "${declared}"; it must be one of ${APP_ENVIRONMENTS.join(", ")}`,
  );
}

/** The one origin an accepted staging build may talk to. */
export const STAGING_ORIGIN = "https://vih786wuduzmldekoq3zdies.syntavera.dev";

/**
 * Left in `eas.json` on purpose: the production host is not decided, and production is not
 * deployed (`docs/PRODUCTION_V1_GO_LIVE.md` §4). A build that shipped with it would resolve
 * nothing and say nothing about why.
 */
const PRODUCTION_PLACEHOLDER = "replace-with-production-host";

/**
 * A reference to the target that is safe to put in an error, and then in a build log.
 *
 * The origin itself is public — it is in the bundle either way — but a URL can carry
 * `user:password@` in its authority, and an error message is the one place that would travel
 * somewhere a bundle does not. So a message names the **host** and nothing else, and says so
 * loudly when credentials were embedded rather than quietly printing them. Nothing here prints a
 * path, a query or a fragment either: a token smuggled into one of those would travel the same way.
 */
function describeTarget(target: URL): string {
  if (target.username !== "" || target.password !== "") return "<a URL with embedded credentials>";
  return target.host;
}

/**
 * The target, read as a URL rather than as a string.
 *
 * Every check below used to be `startsWith`, and a prefix is not an origin: `localhost` is a
 * prefix of `localhost.evil.invalid`, and a host nobody vetted was therefore classified as the
 * developer's own machine. The platform already has a parser that knows what an authority is —
 * the same one `describeTarget` uses — so the comparisons are made on what it returns.
 */
function parseTarget(apiBaseUrl: string): URL {
  let target: URL;
  try {
    target = new URL(apiBaseUrl);
  } catch {
    throw new MisconfiguredFieldBuild(
      "EXPO_PUBLIC_API_URL is not a URL this build can parse; it must be an origin such as https://host",
    );
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new MisconfiguredFieldBuild(
      `EXPO_PUBLIC_API_URL uses the scheme "${target.protocol.replace(":", "")}"; it must be http or https`,
    );
  }
  return target;
}

/**
 * Loopback by parsed hostname, exactly.
 *
 * The three names the platform resolves to this machine, plus the rest of `127.0.0.0/8`, which
 * `URL` canonicalises into a dotted quad before we see it. `localhost.evil.invalid` and
 * `127.0.0.1.evil.invalid` are ordinary remote hosts and are treated as such, which is the whole
 * point of parsing: they are somebody else's machines wearing a familiar prefix.
 */
function isLoopback(target: URL): boolean {
  const { hostname } = target;
  if (hostname === "localhost" || hostname === "[::1]") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/**
 * An API base is an **origin**: a scheme, a host, and at most a non-default port.
 *
 * Everything else a URL can carry is refused rather than ignored, because each one is a way for
 * two targets that differ to compare equal as origins and then behave differently at runtime.
 * `user:password@` is a credential in a public bundle; `/api` and `?x=1` ride along on every
 * request the application makes and are exactly where a smuggled token would sit. A single
 * trailing slash has already been trimmed by the caller, so the only path that survives here is
 * the root one `URL` supplies.
 */
function assertBareOrigin(target: URL): void {
  if (target.username !== "" || target.password !== "") {
    throw new MisconfiguredFieldBuild(
      "EXPO_PUBLIC_API_URL carries embedded credentials; a build may only name an origin, and a bundle is public",
    );
  }
  const host = describeTarget(target);
  if (target.pathname !== "/" && target.pathname !== "") {
    throw new MisconfiguredFieldBuild(
      `EXPO_PUBLIC_API_URL points at a path under ${host}; a build may only name an origin`,
    );
  }
  if (target.search !== "") {
    throw new MisconfiguredFieldBuild(
      `EXPO_PUBLIC_API_URL carries a query string for ${host}; a build may only name an origin`,
    );
  }
  if (target.hash !== "") {
    throw new MisconfiguredFieldBuild(
      `EXPO_PUBLIC_API_URL carries a fragment for ${host}; a build may only name an origin`,
    );
  }
}

/**
 * The environment and the target have to agree, and a disagreement stops the build.
 *
 * The first version of this only guarded one axis — remote-vs-localhost — which left the two
 * cases that actually matter wide open: a **staging** build aimed at a production host, and a
 * **production** build aimed at staging. The first writes real answers into a demonstration; the
 * second shows a client a study that does not exist. Neither is caught by a label, because by
 * then the label is the lie.
 *
 * The second version enumerated the three environments but compared raw strings, which is a
 * weaker guard than it reads as: a production build aimed at `STAGING_ORIGIN + "/api"`, or at the
 * same host with its default `:443` spelled out, is aimed at staging and compared unequal. So the
 * comparison is now between **canonical origins** — what `URL` returns once it has normalised the
 * port and lower-cased the host — and anything that is not purely an origin has already been
 * refused above. Three environments, three rules, deny by default, no hostname heuristics.
 */
function assertCoherent(environment: AppEnvironment, apiBaseUrl: string): void {
  const target = parseTarget(apiBaseUrl);
  assertBareOrigin(target);

  const host = describeTarget(target);
  const staging = new URL(STAGING_ORIGIN);

  if (environment === "local") {
    if (!isLoopback(target)) {
      throw new MisconfiguredFieldBuild(
        `a local build points at ${host}, which is not a loopback host`,
      );
    }
    return;
  }

  if (isLoopback(target)) {
    throw new MisconfiguredFieldBuild(
      `a ${environment} build points at the loopback host ${host}; EXPO_PUBLIC_API_URL was not set to a real backend`,
    );
  }

  if (environment === "staging") {
    // Exact origin. The retired Vercel UAT host, a production host and a typo all land here
    // together, which is the point.
    if (target.origin !== staging.origin) {
      throw new MisconfiguredFieldBuild(
        `a staging build points at ${host}; staging may only target ${staging.host}`,
      );
    }
    return;
  }

  // production
  if (target.hostname.includes(PRODUCTION_PLACEHOLDER)) {
    throw new MisconfiguredFieldBuild(
      "a production build still carries the placeholder host; the production host is not decided",
    );
  }
  if (target.origin === staging.origin) {
    throw new MisconfiguredFieldBuild(`a production build points at the staging host ${host}`);
  }
  if (target.protocol !== "https:") {
    throw new MisconfiguredFieldBuild(`a production build points at ${host} over plain HTTP`);
  }
}

export function fieldConfig(): FieldConfig {
  const url = process.env["EXPO_PUBLIC_API_URL"]?.trim();
  const apiBaseUrl = (url && url.length > 0 ? url : FALLBACK).replace(/\/+$/, "");
  const environment = readEnvironment(process.env["EXPO_PUBLIC_APP_ENV"]);
  assertCoherent(environment, apiBaseUrl);
  return {
    apiBaseUrl,
    appVersion: Constants.expoConfig?.version ?? "0.0.0",
    environment,
    environmentLabel: LABELS[environment],
  };
}
