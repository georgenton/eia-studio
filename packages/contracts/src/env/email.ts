import { z } from "zod";

/** Email boundary: no transactional provider is selected in Slice 0 (console/no-op adapters). */
export const emailEnvSchema = z
  .object({
    EMAIL_ADAPTER: z.enum(["console", "noop"]).default("console"),
    EMAIL_FROM: z.string().min(3).default("no-reply@localhost"),
  })
  .strict();

export type EmailEnv = z.infer<typeof emailEnvSchema>;
