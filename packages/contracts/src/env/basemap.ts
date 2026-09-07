import { z } from "zod";

/**
 * The reference basemap, if this deployment has one.
 *
 * **Shape only.** Whether the resulting configuration can actually draw anything is decided by
 * `resolveBasemapCatalogue` in the domain, which never throws: an unknown provider, a missing key
 * or a malformed template all resolve to "no background", because the map surface must work
 * without one. Nothing here is required, and nothing here can stop the application booting.
 *
 * **These values reach the browser**, and they have to: a map key is used by the map, which runs
 * in the reader's browser. It is therefore a *public* credential — restricted by allowed origin
 * and by a spend cap at the provider, never by secrecy (`docs/BASEMAP_POLICY.md` §6). A server
 * secret must never be put here.
 *
 * They are read at **request time** rather than inlined at build time, so a deployment can turn a
 * background on, change provider or withdraw a key by restarting a process rather than rebuilding
 * — and so one build can serve an environment with a background and one without, which is how the
 * end-to-end suite covers both.
 */
export const basemapEnvSchema = z
  .object({
    /** `none` (default), `maptiler`, or `custom` for a self-hosted XYZ service. */
    BASEMAP_PROVIDER: z.string().min(1).optional(),
    /** Public, origin-restricted browser key. Never a server credential. */
    MAPTILER_KEY: z.string().min(1).optional(),
    /** `custom` only: an XYZ template containing `{z}`, `{x}` and `{y}`. */
    BASEMAP_TILE_URL: z.string().min(1).optional(),
    /** `custom` only: the attribution that service requires, shown verbatim. */
    BASEMAP_ATTRIBUTION: z.string().min(1).optional(),
  })
  .strict();

export type BasemapEnv = z.infer<typeof basemapEnvSchema>;
