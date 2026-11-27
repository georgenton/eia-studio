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

/* ---------------------------------------------------------------------------------------------
 * Which tiles answered, for the set of tiles that is on screen *now*
 * ------------------------------------------------------------------------------------------ */

export type TileResult = "ok" | "fail";

/**
 * What the background tiles did, kept per request rather than in one running tally.
 *
 * ## The two ways a tally lies
 *
 * An `Image` answers whenever the platform gets round to it, which can be after the technician
 * has already panned. A single `Record<tileKey, result>` therefore mixes two frames together,
 * and both directions are wrong on screen:
 *
 * - **A late failure from a tile that is no longer visible** turns the current frame's notice
 *   into *some tiles did not load*, naming tiles that are not being asked for.
 * - **A tile that is still mounted between two frames** — pan a little and most of them are —
 *   has already loaded, so it will never fire `onLoad` again. Clearing the whole record on every
 *   frame therefore loses its verdict and under-counts what actually painted, which reads as a
 *   partial background over a map that is completely drawn.
 *
 * So the record carries the set it belongs to and the attempt it belongs to. A report for another
 * set is **ignored**, and a frame change **keeps** the verdicts of tiles that are still on screen.
 * A retry changes the attempt, every `Image` remounts, and everything is discarded — which is what
 * makes the retry a real retry rather than a re-render.
 */
export interface TileOutcomes {
  /** The retry generation. Every `Image` is keyed by it, so a change remounts all of them. */
  readonly attempt: number;
  /** The exact set of tiles these verdicts are about. */
  readonly forSet: string;
  readonly byTile: Readonly<Record<string, TileResult>>;
}

export function tileSetKeyOf(attempt: number, tileKeys: ReadonlyArray<string>): string {
  return `${attempt}:${tileKeys.join("|")}`;
}

/**
 * The verdicts that still apply to the set now on screen.
 *
 * Carried over only when the attempt is unchanged — a retry remounts every image, so nothing an
 * earlier attempt said is about anything that is still loading — and only for tiles the new set
 * actually contains.
 */
export function carryOverOutcomes(
  current: TileOutcomes,
  next: { readonly attempt: number; readonly tileKeys: ReadonlyArray<string> },
): Readonly<Record<string, TileResult>> {
  if (current.attempt !== next.attempt) return {};
  const kept: Record<string, TileResult> = {};
  for (const key of next.tileKeys) {
    const result = current.byTile[key];
    if (result !== undefined) kept[key] = result;
  }
  return kept;
}

/** Record one `Image`'s answer, or ignore it because the view has moved on. */
export function recordTileResult(
  current: TileOutcomes,
  report: { readonly forSet: string; readonly tileKey: string; readonly result: TileResult },
): TileOutcomes {
  if (current.forSet !== report.forSet) return current;
  if (current.byTile[report.tileKey] === report.result) return current;
  return { ...current, byTile: { ...current.byTile, [report.tileKey]: report.result } };
}

/** Count only the tiles being asked for right now; a verdict about any other is not evidence. */
export function countVisible(
  tileKeys: ReadonlyArray<string>,
  byTile: Readonly<Record<string, TileResult>>,
): { readonly loaded: number; readonly failed: number } {
  let loaded = 0;
  let failed = 0;
  for (const key of tileKeys) {
    if (byTile[key] === "ok") loaded += 1;
    else if (byTile[key] === "fail") failed += 1;
  }
  return { loaded, failed };
}
