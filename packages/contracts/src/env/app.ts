import { z } from "zod";

import { booleanString } from "./common";

/**
 * The environments this product knows about.
 *
 * `demo` is the permanent showcase environment (Cinta Vera three-environment model): synthetic
 * data, its own database, bucket, secrets and domain. It sits between `preview` and `staging`
 * deliberately — it is **persistent**, so `isPersistentEnvironment` treats it exactly like
 * staging and production: no `fake` classifier, no in-memory storage. What `demo` allows that
 * production does not is `DEMO_FIXTURES_ENABLED`, and that stays an explicit opt-in.
 */
export const APP_ENVIRONMENTS = [
  "local",
  "test",
  "preview",
  "demo",
  "staging",
  "production",
] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export const appEnvSchema = z
  .object({
    APP_ENV: z.enum(APP_ENVIRONMENTS).default("local"),
    PUBLIC_APP_URL: z.url(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    DEMO_FIXTURES_ENABLED: booleanString.default(false),
  })
  .strict()
  .refine((v) => !(v.APP_ENV === "production" && v.DEMO_FIXTURES_ENABLED), {
    message: "DEMO_FIXTURES_ENABLED must be false in production",
    path: ["DEMO_FIXTURES_ENABLED"],
  });

export type AppEnv = z.infer<typeof appEnvSchema>;
