/**
 * What the device may truthfully say about the reference background.
 *
 * ## The claim this exists to stop
 *
 * The first version said *Mapa de referencia del proveedor* whenever a tile template had been
 * configured. Configured is not loaded. With a key that 403s, with no signal, or with a provider
 * part-way through an outage, a technician would read that sentence while looking at geometry on
 * a plain ground — the product asserting something the screen plainly contradicts.
 *
 * So the sentence is derived from what the `Image` elements actually reported, and "configured"
 * never appears in it.
 *
 * ## Partial is its own state
 *
 * A background that loaded four tiles of nine is a real and common thing — a slow link, a
 * provider rate-limiting, a zoom level with gaps. Rounding it to "available" tells somebody the
 * blank quarter of their screen is open ground; rounding it to "unavailable" throws away the
 * three quarters that arrived. It is named.
 */
export type BasemapLoadState =
  /** No template at all: the deployment has no key, or the stored map predates the field. */
  | "none"
  /** Tiles requested, nothing has reported back yet. */
  | "loading"
  | "available"
  | "partial"
  /** Every tile that reported, failed. */
  | "unavailable";

export function basemapLoadState(input: {
  readonly configured: boolean;
  readonly requested: number;
  readonly loaded: number;
  readonly failed: number;
}): BasemapLoadState {
  if (!input.configured) return "none";
  if (input.requested === 0) return "loading";
  const settled = input.loaded + input.failed;
  if (settled === 0) return "loading";
  if (input.loaded === 0) return "unavailable";
  /*
   * Still waiting on some is reported as **partial** rather than as loading, once anything has
   * arrived: a reader can already see imagery, and calling that "loading" would be the mirror of
   * the original lie. It settles to `available` when the last one lands.
   */
  if (input.failed > 0 || settled < input.requested) return "partial";
  return "available";
}

/** Whether the provider's attribution has to be on screen: it has shown us its imagery. */
export function showsProviderImagery(state: BasemapLoadState): boolean {
  return state === "available" || state === "partial";
}
