import { z } from "zod";

/** Better Auth: identity, authentication and sessions only (ADR-010). */
export const authEnvSchema = z
  .object({
    BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    BETTER_AUTH_URL: z.url(),
    AUTH_TRUSTED_ORIGINS: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      ),
  })
  .strict();

export type AuthEnv = z.infer<typeof authEnvSchema>;
