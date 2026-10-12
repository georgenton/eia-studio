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
const PRODUCTION_PLACEHOLDER = "REPLACE-WITH-PRODUCTION-HOST";

function isLocalOrigin(apiBaseUrl: string): boolean {
  return (
    apiBaseUrl.startsWith("http://localhost") ||
    apiBaseUrl.startsWith("http://127.0.0.1") ||
    apiBaseUrl.startsWith("http://[::1]")
  );
}

/**
 * A reference to the target that is safe to put in an error, and then in a build log.
 *
 * The origin itself is public — it is in the bundle either way — but a URL can carry
 * `user:password@` in its authority, and an error message is the one place that would travel
 * somewhere a bundle does not. So a message names the **host** and nothing else, and says so
 * loudly when credentials were embedded rather than quietly printing them.
 */
function safeTarget(apiBaseUrl: string): string {
  try {
    const u = new URL(apiBaseUrl);
    if (u.username !== "" || u.password !== "") return "<a URL with embedded credentials>";
    return u.host;
  } catch {
    return "<an unparseable URL>";
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
 * So the relationship is enumerated, not inferred. Three environments, three rules, deny by
 * default. No hostname heuristics: staging is *one exact origin*, and anything else — however
 * plausible it looks — is a build that nobody decided to make.
 */
function assertCoherent(environment: AppEnvironment, apiBaseUrl: string): void {
  const target = safeTarget(apiBaseUrl);

  if (environment === "local") {
    if (!isLocalOrigin(apiBaseUrl)) {
      throw new MisconfiguredFieldBuild(`a local build points at ${target}, which is not local`);
    }
    return;
  }

  if (isLocalOrigin(apiBaseUrl)) {
    throw new MisconfiguredFieldBuild(
      `a ${environment} build fell back to a local host; EXPO_PUBLIC_API_URL was not set`,
    );
  }

  if (environment === "staging") {
    // Exact, after the trailing slash has already been trimmed. The retired Vercel UAT host, a
    // production host and a typo all land here together, which is the point.
    if (apiBaseUrl !== STAGING_ORIGIN) {
      throw new MisconfiguredFieldBuild(
        `a staging build points at ${target}; staging may only target ${safeTarget(STAGING_ORIGIN)}`,
      );
    }
    return;
  }

  // production
  if (apiBaseUrl === STAGING_ORIGIN) {
    throw new MisconfiguredFieldBuild(`a production build points at the staging host ${target}`);
  }
  if (apiBaseUrl.includes(PRODUCTION_PLACEHOLDER)) {
    throw new MisconfiguredFieldBuild(
      "a production build still carries the placeholder host; the production host is not decided",
    );
  }
  if (!apiBaseUrl.startsWith("https://")) {
    throw new MisconfiguredFieldBuild(`a production build points at ${target} over plain HTTP`);
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
