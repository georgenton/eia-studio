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

/**
 * The two facts have to agree, and a disagreement stops the build rather than shipping.
 *
 * A staging build that fell back to `localhost` would be a phone that cannot reach anything and
 * says nothing about why. A staging build pointed at the production host would be worse: real
 * answers, under a label nobody reads twice.
 */
function assertCoherent(environment: AppEnvironment, apiBaseUrl: string): void {
  const isLocalHost = apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1");
  if (environment !== "local" && isLocalHost) {
    throw new MisconfiguredFieldBuild(
      `a ${environment} build fell back to ${apiBaseUrl}; EXPO_PUBLIC_API_URL was not set`,
    );
  }
  if (environment === "local" && !isLocalHost) {
    throw new MisconfiguredFieldBuild(
      `a local build points at ${apiBaseUrl}, which is not a local host`,
    );
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
