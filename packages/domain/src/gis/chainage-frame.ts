import { InvalidInput } from "../core/errors";

import { formatChainage } from "./linear-reference";

/**
 * The relation between *distance along a route* and *the abscissa written on it*.
 *
 * ## Why this is its own idea, and arithmetic rather than a query
 *
 * A road's chainage is not a measurement of its geometry. It is a reference system a survey
 * declared: where 0+000 is, which way the numbers run, and — when there are chainage equations —
 * where the numbering jumps. Distance along the line is a measurement; the abscissa is a
 * statement. Conflating them produces the two errors this module exists to stop:
 *
 * 1. **Assuming the first vertex is 0+000.** A study of a *segment* of a road starts at the
 *    abscissa the road already had there. Printing 0+000 at its first vertex renames the whole
 *    road, and every milestone after it is wrong by the same offset.
 * 2. **Assuming the numbers run with the geometry.** A line digitised from the far end carries
 *    chainage that *decreases* as the geometry advances. Nothing in the geometry says which it is.
 *
 * So the frame is declared, the arithmetic is pure, and the measurement that feeds it is taken
 * elsewhere — in the dataset's projected CRS, over the whole route (see
 * `@eia/application`'s `measureRoute`). Keeping them apart is what lets this be unit-tested
 * exhaustively: a simple line, a multi-part route, an origin that is not zero, and a reversed
 * direction are four cases of one function rather than four database fixtures.
 *
 * ## What it refuses to do
 *
 * It does not invent a frame. A project that has not declared its origin and direction gets
 * `declared: false` from the caller and its milestones are labelled **calculated distance**, not
 * abscissas — because a kilometre post that says `3+000` when nobody checked where 0+000 is, is a
 * fabricated reference, and a field technician would navigate by it.
 */
export interface ChainageFrame {
  /**
   * The length of the route, in metres, measured in a **projected** CRS.
   *
   * Never a length computed in EPSG:4326: degrees are not metres, and the two axes are not even
   * the same size as each other away from the equator.
   */
  readonly routeLengthM: number;
  /** The abscissa at the **first vertex of the stored geometry**, in metres. */
  readonly startChainageM: number;
  /**
   * Whether the abscissa increases along the stored direction of the geometry.
   *
   * `reverse` means the line was digitised against the road's numbering: chainage *decreases* as
   * distance along the geometry increases.
   */
  readonly direction: "forward" | "reverse";
}

export interface Milestone {
  /** The abscissa this post carries, in metres. A whole multiple of the spacing. */
  readonly chainageM: number;
  /** How far along the stored geometry it sits, in metres from the first vertex. */
  readonly distanceAlongM: number;
  /** `0+000`, `1+000`, … — surveying notation, written the same way in either language. */
  readonly label: string;
}

/** One kilometre, the spacing the brief asks for and the only one a road is posted at by default. */
export const DEFAULT_MILESTONE_SPACING_M = 1000;

export function assertChainageFrame(frame: ChainageFrame): void {
  if (!Number.isFinite(frame.routeLengthM) || frame.routeLengthM <= 0) {
    throw new InvalidInput("a chainage frame needs a positive route length in metres");
  }
  if (!Number.isFinite(frame.startChainageM) || frame.startChainageM < 0) {
    throw new InvalidInput("a start chainage cannot be negative");
  }
  if (frame.direction === "reverse" && frame.startChainageM < frame.routeLengthM) {
    /*
     * A reversed route whose start abscissa is smaller than its own length would run below 0+000
     * before it ended. That is a contradictory declaration rather than an unusual road, and
     * silently clamping it would move every milestone on the corridor.
     */
    throw new InvalidInput(
      "a reversed route cannot start at an abscissa smaller than its own length: " +
        `${formatChainage(frame.startChainageM)} over ${Math.round(frame.routeLengthM)} m`,
    );
  }
}

/** The abscissa at a given distance along the stored geometry. */
export function chainageAt(frame: ChainageFrame, distanceAlongM: number): number {
  assertChainageFrame(frame);
  if (distanceAlongM < 0 || distanceAlongM > frame.routeLengthM) {
    throw new InvalidInput(
      `a distance of ${Math.round(distanceAlongM)} m is outside a route of ` +
        `${Math.round(frame.routeLengthM)} m`,
    );
  }
  return frame.direction === "forward"
    ? frame.startChainageM + distanceAlongM
    : frame.startChainageM - distanceAlongM;
}

/** How far along the stored geometry an abscissa sits. Null when it is off the route. */
export function distanceAlongFor(frame: ChainageFrame, chainageM: number): number | null {
  assertChainageFrame(frame);
  const distance =
    frame.direction === "forward"
      ? chainageM - frame.startChainageM
      : frame.startChainageM - chainageM;
  if (distance < 0 || distance > frame.routeLengthM) return null;
  return distance;
}

/** The abscissa range the route covers, lowest first, whichever way the numbers run. */
export function chainageRange(frame: ChainageFrame): {
  readonly fromM: number;
  readonly toM: number;
} {
  assertChainageFrame(frame);
  const a = frame.startChainageM;
  const b = chainageAt(frame, frame.routeLengthM);
  return a <= b ? { fromM: a, toM: b } : { fromM: b, toM: a };
}

/**
 * The kilometre posts of a route: every whole multiple of the spacing **that the route actually
 * covers**, in increasing abscissa.
 *
 * The posts follow the *abscissa*, not the straight-line distance between coordinates and not a
 * count from the first vertex. A segment running 2+300 → 5+800 is posted at 3+000, 4+000 and
 * 5+000 — three posts, none of them at either end — because those are the kilometres of the road
 * it passes. A segment shorter than one spacing gets none, which is the honest answer rather than
 * a post invented at its midpoint.
 */
export function milestonesFor(
  frame: ChainageFrame,
  spacingM: number = DEFAULT_MILESTONE_SPACING_M,
): ReadonlyArray<Milestone> {
  assertChainageFrame(frame);
  if (!Number.isFinite(spacingM) || spacingM <= 0) {
    throw new InvalidInput("a milestone spacing must be a positive number of metres");
  }

  const { fromM, toM } = chainageRange(frame);
  const first = Math.ceil(fromM / spacingM) * spacingM;
  const posts: Milestone[] = [];
  for (let chainageM = first; chainageM <= toM + 1e-6; chainageM += spacingM) {
    const distanceAlongM = distanceAlongFor(frame, chainageM);
    /*
     * `distanceAlongFor` can only be null here through floating-point drift at the very end of the
     * route, and a post half a millimetre past the last vertex is not a post. Skipping is
     * deliberate: clamping it to the end would draw a kilometre marker at a place that is not that
     * kilometre.
     */
    if (distanceAlongM === null) continue;
    posts.push({
      chainageM,
      distanceAlongM,
      label: formatChainage(chainageM),
    });
  }
  return posts;
}
