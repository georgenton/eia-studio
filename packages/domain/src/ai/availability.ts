import { AiUnavailable } from "../core/errors";

/**
 * Whether an AI-backed feature may run at all, and why not when it may not (IG4-001).
 *
 * It lives in `ai/` rather than `social/` because it now governs two adapters — the classifier and
 * the assistant's narrative generator — and the point of the rule is that there is exactly one of
 * it. A copy per feature is a predicate that can drift, and the predicate is the whole guarantee.
 *
 * ## The failure this closes
 *
 * `SOCIAL_CLASSIFIER` used to default to `fake`. A persistent environment that simply never set
 * the variable would therefore have run the deterministic keyword matcher and written its output
 * into `ai_classification` — rows indistinguishable, once stored, from proposals a real model
 * produced. Nobody would have been lied to on purpose; the default would have done it.
 *
 * So selection is now explicit everywhere, and this function is the single place that decides:
 *
 * | environment | unset | `fake` | `ai-gateway`, no key | `ai-gateway`, key |
 * |---|---|---|---|---|
 * | `local`, `test` | unavailable | **available** | blocked | available (live) |
 * | anything else | unavailable | **refused** | blocked | available (live) |
 *
 * Three properties are deliberate:
 *
 * - **unknown environments are persistent.** The predicate names the two environments where a fake
 *   is legitimate and treats everything else — including a value nobody has thought of yet — as
 *   persistent. A misspelt `APP_ENV` loses assisted coding; it does not gain a fake one.
 * - **unavailable is not an error.** Deterministic tabulation never asks a model for a number, so
 *   it keeps working while this says `UNAVAILABLE`. Only the coding half stops.
 * - **there is no fallback in either direction.** A gateway without its credential is
 *   `BLOCKED_EXTERNAL_CONFIG`, never a quiet demotion to the fake.
 */
export const SOCIAL_CLASSIFIER_KINDS = ["fake", "ai-gateway"] as const;
export type ClassifierKind = (typeof SOCIAL_CLASSIFIER_KINDS)[number];

export type ClassifierUnavailableReason =
  /** Nothing configured. The product simply has no assisted coding here. */
  | "NOT_CONFIGURED"
  /** A deterministic fake was asked for somewhere its output would be mistaken for real. */
  | "FAKE_REFUSED_IN_PERSISTENT_ENVIRONMENT"
  /** The live adapter is selected but its external configuration is incomplete. */
  | "BLOCKED_EXTERNAL_CONFIG";

export type ClassifierAvailability =
  | {
      readonly state: "AVAILABLE";
      readonly kind: ClassifierKind;
      /** The model a run will ask for; recorded on the run, never chosen by a client. */
      readonly model: string;
      /** True when text actually leaves this system. */
      readonly live: boolean;
    }
  | {
      readonly state: "UNAVAILABLE";
      readonly reason: ClassifierUnavailableReason;
      /** Operator-facing English; names variables, never values. */
      readonly detail: string;
    };

export interface ClassifierAvailabilityInput {
  /** `APP_ENV`. Anything but `local` or `test` is treated as persistent (fail closed). */
  readonly appEnv: string;
  /** `SOCIAL_CLASSIFIER`, absent when nobody configured one. */
  readonly classifier: ClassifierKind | undefined;
  /** `SOCIAL_CLASSIFIER_MODEL`. */
  readonly model: string | undefined;
  /** Presence only. The value is read by the AI SDK, never by us. */
  readonly gatewayApiKeyPresent: boolean;
}

/**
 * An environment whose rows outlive the process that wrote them.
 *
 * Named positively for `local` and `test`, so that an environment nobody anticipated is persistent
 * rather than permissive.
 */
export function isPersistentEnvironment(appEnv: string): boolean {
  return appEnv !== "local" && appEnv !== "test";
}

export function resolveClassifierAvailability(
  input: ClassifierAvailabilityInput,
): ClassifierAvailability {
  return resolveAiAdapterAvailability({
    appEnv: input.appEnv,
    variable: "SOCIAL_CLASSIFIER",
    modelVariable: "SOCIAL_CLASSIFIER_MODEL",
    feature: "assisted coding",
    adapter: input.classifier,
    model: input.model,
    credentialPresent: input.gatewayApiKeyPresent,
  });
}

/**
 * The same rule, for any adapter that may or may not have a live provider behind it.
 *
 * Slice 6 added a second one (the assistant's narrative generator), and the choice was between
 * copying thirty lines of policy or naming the variables. Copying would have meant two places to
 * change the day the environment predicate changes, and the predicate is the part that must not
 * drift: it is what keeps a persistent environment from silently running a stand-in.
 */
export interface AiAdapterAvailabilityInput {
  readonly appEnv: string;
  /** The environment variable that selects the adapter, named in the operator-facing detail. */
  readonly variable: string;
  readonly modelVariable: string;
  /** What is lost when it is unavailable, in the detail text: "assisted coding", "the assistant". */
  readonly feature: string;
  readonly adapter: ClassifierKind | undefined;
  readonly model: string | undefined;
  readonly credentialPresent: boolean;
}

export function resolveAiAdapterAvailability(
  input: AiAdapterAvailabilityInput,
): ClassifierAvailability {
  const persistent = isPersistentEnvironment(input.appEnv);

  if (input.adapter === undefined) {
    return {
      state: "UNAVAILABLE",
      reason: "NOT_CONFIGURED",
      detail:
        `${input.variable} is not set, so ${input.feature} is unavailable here. Everything that ` +
        "does not depend on a model keeps working.",
    };
  }

  if (input.adapter === "fake") {
    if (persistent) {
      return {
        state: "UNAVAILABLE",
        reason: "FAKE_REFUSED_IN_PERSISTENT_ENVIRONMENT",
        detail:
          `${input.variable}=fake is refused in APP_ENV=${input.appEnv}. The deterministic ` +
          "adapter exists for automated tests; its output stored in a persistent environment " +
          "would be indistinguishable from a real model's.",
      };
    }
    return {
      state: "AVAILABLE",
      kind: "fake",
      model: input.model && input.model.length >= 3 ? input.model : "fake/deterministic",
      live: false,
    };
  }

  if (!input.credentialPresent) {
    return {
      state: "UNAVAILABLE",
      reason: "BLOCKED_EXTERNAL_CONFIG",
      detail:
        `${input.variable}=ai-gateway but AI_GATEWAY_API_KEY is not set. Refusing to fall back ` +
        "to the deterministic fake: a fabricated result is indistinguishable from a real one " +
        "once it is a row in a table.",
    };
  }

  // A gateway model id names its provider. Without one the SDK would resolve something other than
  // what the run records, and the run's `requested_model` would be a fiction.
  if (!input.model || !input.model.includes("/") || input.model.length < 3) {
    return {
      state: "UNAVAILABLE",
      reason: "BLOCKED_EXTERNAL_CONFIG",
      detail:
        `${input.modelVariable} must be a provider-qualified gateway model id, e.g. ` +
        "anthropic/claude-sonnet-4.5.",
    };
  }

  return { state: "AVAILABLE", kind: "ai-gateway", model: input.model, live: true };
}

/**
 * The gate every write path takes.
 *
 * A `ClassificationRun` that can never be processed is worse than no run: the queue shows work
 * that will not move, the surface shows a pending proposal that will never arrive, and the only
 * way to tell is to read the worker's logs. So nothing is written unless a classifier is actually
 * available, and the caller gets the reason.
 */
export function requireAvailableClassifier(
  availability: ClassifierAvailability,
): Extract<ClassifierAvailability, { state: "AVAILABLE" }> {
  if (availability.state === "AVAILABLE") return availability;
  throw new AiUnavailable({ reason: availability.reason, detail: availability.detail });
}
