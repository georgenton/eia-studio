/**
 * Whether this deployment can store a file at all — and why not, when it cannot.
 *
 * The same shape as `resolveClassifierAvailability` (IG4-001), for the same reason. An unset
 * configuration must mean **the feature is unavailable**, never a quiet fallback to something that
 * produces artefacts indistinguishable from the real thing. For a model that was a fabricated
 * coding; here it would be a document row pointing at an object nobody can fetch, which is worse:
 * the row survives the deployment that created it.
 *
 * ## No in-memory fallback in a persistent environment
 *
 * A memory-backed store is genuinely useful in a unit test and genuinely dangerous anywhere else:
 * a `DocumentVersion` whose bytes lived in a process that has since exited is a citation nobody can
 * resolve, and it looks exactly like one that can. So `memory` is refused outside `local` and
 * `test`, by the same predicate the classifier uses.
 *
 * ## A missing credential is a state, not a crash
 *
 * The process still boots. Taking a deployment down over a feature it may not use that day would
 * be a worse outcome than losing the feature, and the surfaces say which of the three reasons it is.
 */
export const STORAGE_PROVIDERS = ["s3", "memory"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export type StorageAvailability =
  | { readonly state: "AVAILABLE"; readonly provider: StorageProvider; readonly live: boolean }
  | {
      readonly state: "UNAVAILABLE";
      readonly reason:
        "NOT_CONFIGURED" | "MEMORY_REFUSED_IN_PERSISTENT_ENVIRONMENT" | "BLOCKED_EXTERNAL_CONFIG";
      /** Operator-facing. Names variables, never a credential, and never reaches a screen. */
      readonly detail: string;
    };

export interface StorageAvailabilityInput {
  readonly appEnv: string;
  /** Raw configuration. An unrecognised name is *not* a provider; it is a misconfiguration. */
  readonly provider: string | undefined;
  readonly bucket: string | undefined;
  readonly endpoint: string | undefined;
  readonly region: string | undefined;
  readonly credentialsPresent: boolean;
}

/**
 * `local` and `test` are the only environments that may run the in-memory store.
 *
 * Stated positively: every other value — including a misspelt one — is persistent. A typo loses
 * file storage rather than gaining a store whose contents vanish with the process.
 */
export function isPersistentStorageEnvironment(appEnv: string): boolean {
  return appEnv !== "local" && appEnv !== "test";
}

export function isStorageProvider(value: string): value is StorageProvider {
  return (STORAGE_PROVIDERS as readonly string[]).includes(value);
}

export function resolveStorageAvailability(input: StorageAvailabilityInput): StorageAvailability {
  if (input.provider === undefined || input.provider === "") {
    return {
      state: "UNAVAILABLE",
      reason: "NOT_CONFIGURED",
      detail:
        "STORAGE_PROVIDER is not set, so file upload is unavailable here. Everything that does " +
        "not store a file keeps working.",
    };
  }

  // A misspelt provider is reported as itself rather than silently read as one of the two we
  // know. Being told `s3x` is not a provider is a fixable message; being told the variable is
  // unset when it plainly is set sends an operator looking in the wrong place.
  if (!isStorageProvider(input.provider)) {
    return {
      state: "UNAVAILABLE",
      reason: "NOT_CONFIGURED",
      detail:
        `STORAGE_PROVIDER=${input.provider} is not a provider this build knows. ` +
        `Expected one of: ${STORAGE_PROVIDERS.join(", ")}.`,
    };
  }

  if (input.provider === "memory") {
    if (isPersistentStorageEnvironment(input.appEnv)) {
      return {
        state: "UNAVAILABLE",
        reason: "MEMORY_REFUSED_IN_PERSISTENT_ENVIRONMENT",
        detail:
          `STORAGE_PROVIDER=memory is refused in APP_ENV=${input.appEnv}. The in-memory store ` +
          "exists for automated tests; a document version stored in a process that later exits " +
          "is a citation nobody can resolve, and it looks exactly like one that can.",
      };
    }
    return { state: "AVAILABLE", provider: "memory", live: false };
  }

  const missing = [
    input.bucket === undefined || input.bucket === "" ? "STORAGE_BUCKET" : null,
    input.region === undefined || input.region === "" ? "STORAGE_REGION" : null,
    input.credentialsPresent ? null : "STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY",
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    return {
      state: "UNAVAILABLE",
      reason: "BLOCKED_EXTERNAL_CONFIG",
      detail:
        `STORAGE_PROVIDER=s3 but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} ` +
        "not set. Refusing to fall back to the in-memory store: a file that is not where the " +
        "database says it is would be discovered by whoever needed it most.",
    };
  }

  return { state: "AVAILABLE", provider: "s3", live: true };
}
