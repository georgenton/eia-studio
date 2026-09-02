import { z } from "zod";

import { booleanString } from "./common";

/**
 * S3-compatible object storage boundary (ARCHITECTURE.md §9). Optional in Slice 0: either all
 * connection variables are present (adapter enabled) or none (adapter disabled).
 */
export const storageEnvSchema = z
  .object({
    STORAGE_ENDPOINT: z.url().optional(),
    STORAGE_REGION: z.string().min(1).optional(),
    STORAGE_BUCKET: z.string().min(1).optional(),
    STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
    STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    STORAGE_FORCE_PATH_STYLE: booleanString.default(true),
  })
  .strict()
  .transform((v) => {
    const values = [
      v.STORAGE_ENDPOINT,
      v.STORAGE_REGION,
      v.STORAGE_BUCKET,
      v.STORAGE_ACCESS_KEY_ID,
      v.STORAGE_SECRET_ACCESS_KEY,
    ];
    const present = values.filter((x) => x !== undefined).length;
    return {
      ...v,
      configured: present === values.length,
      partial: present > 0 && present < values.length,
    };
  })
  .refine((v) => !v.partial, {
    message: "STORAGE_* variables must be all set or all unset",
    path: ["STORAGE_ENDPOINT"],
  });

export type StorageEnv = z.infer<typeof storageEnvSchema>;
