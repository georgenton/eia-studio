import { z } from "zod";

/**
 * The one place that decides which classifier runs and which model it asks for.
 *
 * Nothing else in the codebase names a model. A run stores the model it was configured with and
 * the model the provider says answered, so changing this configuration later produces a *new* run
 * rather than reinterpreting old classifications (Slice 4 §48).
 *
 * `SOCIAL_CLASSIFIER` is explicit on purpose and has no default that could surprise anyone:
 *
 * - `fake` — the deterministic in-process classifier. Tests, CI and local development. Makes no
 *   network call and needs no credential.
 * - `ai-gateway` — the live adapter, AI SDK v7 through the Vercel AI Gateway.
 *
 * There is no fallback between them in either direction. A staging environment configured for the
 * gateway but missing its key **fails**; it does not quietly produce fabricated codings that are
 * indistinguishable from real ones once they are rows in a table.
 */
export const SOCIAL_CLASSIFIERS = ["fake", "ai-gateway"] as const;

export const socialEnvSchema = z
  .object({
    SOCIAL_CLASSIFIER: z.enum(SOCIAL_CLASSIFIERS).default("fake"),
    /**
     * Provider-qualified model id, resolved by the gateway (e.g. `anthropic/claude-sonnet-4.5`).
     * Required only for the live adapter, and never hardcoded anywhere else.
     */
    SOCIAL_CLASSIFIER_MODEL: z.string().min(3).default("fake/deterministic"),
    /** Presence only. The value is read by the AI SDK itself and never by our code. */
    AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  })
  .strict()
  .refine((v) => v.SOCIAL_CLASSIFIER !== "ai-gateway" || v.AI_GATEWAY_API_KEY !== undefined, {
    message: "SOCIAL_CLASSIFIER=ai-gateway requires AI_GATEWAY_API_KEY",
    path: ["AI_GATEWAY_API_KEY"],
  })
  .refine((v) => v.SOCIAL_CLASSIFIER !== "ai-gateway" || v.SOCIAL_CLASSIFIER_MODEL.includes("/"), {
    message:
      "SOCIAL_CLASSIFIER_MODEL must be a provider-qualified gateway model id, e.g. " +
      "anthropic/claude-sonnet-4.5",
    path: ["SOCIAL_CLASSIFIER_MODEL"],
  });

export type SocialEnv = z.infer<typeof socialEnvSchema>;
