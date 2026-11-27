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
    /**
     * A **second** MapTiler key, for the field application.
     *
     * Separate from `MAPTILER_KEY` because the two are restricted differently and neither
     * restriction works for the other's caller. The browser key is restricted by allowed HTTP
     * origin; a native application sends no `Referer`, so that key answers **403** from a phone —
     * verified against the provider on 26 November 2026, not assumed. MapTiler's documented
     * mechanism for a native application is a key restricted by **Allowed User-Agent header**,
     * and the field application sends a distinctive one.
     *
     * Unset means the device is offered **no reference background** and says so. It is never
     * substituted with the browser key: that key would simply fail, and a map that silently never
     * paints is the failure `probeBasemap` exists to prevent on the web.
     *
     * This value never reaches a build artefact. It is handed to a device that has signed in, in
     * the map response, and stored in the device's encrypted database — ADR-028's rule is that a
     * distributable binary carries no credential, and an APK is readable by whoever holds the
     * phone.
     */
    MAPTILER_MOBILE_KEY: z.string().min(1).optional(),
  })
  .strict();

export type BasemapEnv = z.infer<typeof basemapEnvSchema>;
