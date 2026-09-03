import { z } from "zod";

/**
 * The variables that decide which classifier runs and which model it asks for.
 *
 * This schema validates **shape only**. Whether the resulting configuration may actually run is
 * decided by `resolveClassifierAvailability` in the domain (IG4-001), because that decision
 * depends on `APP_ENV` and must not hard-fail a process: a staging deployment whose gateway
 * credential is missing has to keep serving deterministic social analytics, not refuse to boot.
 *
 * `SOCIAL_CLASSIFIER` has **no default**. A default of `fake` is how a persistent environment ends
 * up storing keyword-matcher output in `ai_classification`, where it is indistinguishable from a
 * real model's proposal. Unset therefore means *no assisted coding here*:
 *
 * - `fake` — the deterministic in-process classifier. Automated tests, and local development when
 *   explicitly selected. No network call, no credential. Refused in persistent environments.
 * - `ai-gateway` — the live adapter, AI SDK v7 through the Vercel AI Gateway.
 *
 * There is no fallback between them in either direction.
 */
export const SOCIAL_CLASSIFIERS = ["fake", "ai-gateway"] as const;

export const socialEnvSchema = z
  .object({
    SOCIAL_CLASSIFIER: z.enum(SOCIAL_CLASSIFIERS).optional(),
    /**
     * Provider-qualified model id, resolved by the gateway (e.g. `anthropic/claude-sonnet-4.5`).
     * Required only for the live adapter, and never hardcoded anywhere else.
     */
    SOCIAL_CLASSIFIER_MODEL: z.string().min(3).optional(),
    /** Presence only. The value is read by the AI SDK itself and never by our code. */
    AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  })
  .strict();

export type SocialEnv = z.infer<typeof socialEnvSchema>;
