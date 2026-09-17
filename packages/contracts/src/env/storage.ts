import { z } from "zod";

/**
 * S3-compatible object storage (ARCHITECTURE.md §9, ADR-031).
 *
 * **Shape only.** Whether this deployment can actually store a file is decided by
 * `resolveStorageAvailability` in the domain, which never throws: an unset provider, a missing
 * bucket or a missing credential all resolve to *unavailable*, with the reason named. Taking a
 * whole deployment down over a feature it may not use that day would be a worse outcome than
 * losing the feature, and the surfaces say which of the three reasons it is.
 *
 * Nothing here reaches the browser. A storage credential signs URLs on the server; the browser
 * receives the signature and never the key (contrast `basemapEnvSchema`, whose key is public by
 * design).
 *
 * `STORAGE_ENDPOINT` is omitted for AWS itself and set for MinIO, Cloudflare R2 and anything
 * self-hosted. Path-style addressing follows from having an endpoint, so it is no longer a
 * separate switch: a provider that needs a custom endpoint needs path style, and one that does not
 * is AWS.
 */
export const storageEnvSchema = z
  .object({
    /** `s3` for any S3-compatible provider, `memory` for local and test only. */
    STORAGE_PROVIDER: z.string().min(1).optional(),
    /**
     * Restricted to `http`/`https`. Zod's bare `url()` accepts `localhost:9000` (protocol
     * `localhost:`) and `ftp://…`, and a signer handed either of those fails at the moment somebody
     * tries to upload a file rather than at boot.
     */
    STORAGE_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
    STORAGE_REGION: z.string().min(1).optional(),
    STORAGE_BUCKET: z.string().min(1).optional(),
    STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
    STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  })
  .strict();

export type StorageEnv = z.infer<typeof storageEnvSchema>;
