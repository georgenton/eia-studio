import { z } from "zod";

import type { ParcelSide, ParcelStatus } from "./parcel";

/**
 * Deterministic generator for a **reconstructed** corridor and its **synthetic** roadside parcels.
 *
 * Why a generator rather than a checked-in GeoJSON blob: 141 hand-written polygons cannot be
 * reviewed, and the moment one is edited nobody can say what the rest represent. A generator is a
 * page of arithmetic anyone can read, it produces byte-identical output on every run, and its
 * version is recorded on the dataset version so a figure on screen can be traced to the code that
 * made it.
 *
 * ## What this is not
 *
 * It is not cadastre and it is not survey. It draws a plausible corridor and plausible frontage
 * parcels so the product can be exercised before the official GIS package arrives. Every feature
 * it produces is stamped `DEMO_SIMULATION`, and the alignment additionally `RECONSTRUCTED`.
 *
 * ## Method
 *
 * 1. The alignment is a polyline through fixed control points, resampled into segments and given
 *    a small deterministic sinuosity so it does not read as a drafting artefact. Control points
 *    are lon/lat near the pilot's corridor; distances are computed in a local metric frame.
 * 2. Parcels are placed at regular chainages, alternating sides, each a quadrilateral spanning a
 *    frontage on the corridor and a depth away from it, both varied deterministically.
 * 3. The affectation of a parcel is the part of it inside the right-of-way strip: a rectangle of
 *    `rightOfWayHalfWidthM` either side of the axis, clipped to the parcel's own frontage.
 *
 * Coordinates come out as `EPSG:4326` lon/lat. The caller transforms them to the storage CRS
 * (`EPSG:32717`), where areas and lengths are computed — doing metric work in degrees is wrong.
 */
export const CORRIDOR_GENERATOR_VERSION = "corridor-generator@1";

export const corridorGeneratorInputSchema = z
  .object({
    /** Any stable string; the same seed always produces the same corridor. */
    seed: z.string().min(1),
    /** Control points of the axis, lon/lat, in order. */
    controlPoints: z.array(z.tuple([z.number(), z.number()])).min(2),
    /** How many parcels to place. The pilot's historical universe is 141. */
    parcelCount: z.number().int().min(1).max(2000),
    /** Nominal frontage on the corridor, in metres; varied deterministically around this. */
    frontageM: z.number().min(5).max(500),
    /** Nominal depth away from the corridor, in metres. */
    depthM: z.number().min(10).max(2000),
    /** Half-width of the right-of-way strip, in metres. */
    rightOfWayHalfWidthM: z.number().min(1).max(100),
    /** Distance between the axis and the near edge of a parcel, in metres. */
    setbackM: z.number().min(0).max(200),
    /** Named stretches of the corridor, in order, each with its share of the length. */
    sectors: z
      .array(z.object({ label: z.string().min(1), share: z.number().min(0).max(1) }))
      .min(1),
    /** Business codes are `${codePrefix}-${nnn}`, numbered from 1 in chainage order. */
    codePrefix: z.string().regex(/^[A-Z][A-Z0-9-]{1,20}$/),
    /** How many parcels get each non-default status, applied deterministically. */
    statusPlan: z.object({
      estimated: z.number().int().min(0),
      notLocated: z.number().int().min(0),
      excluded: z.number().int().min(0),
    }),
  })
  .strict();

export type CorridorGeneratorInput = z.infer<typeof corridorGeneratorInputSchema>;

export type Position = readonly [number, number];
export type Ring = ReadonlyArray<Position>;

export interface GeneratedParcel {
  readonly parcelCode: string;
  readonly sectorLabel: string;
  readonly side: ParcelSide;
  readonly status: ParcelStatus;
  /** Metres along the axis, by the `frontage_midpoint` method. */
  readonly chainageM: number;
  readonly frontageM: number;
  /** Outer ring, closed, lon/lat. */
  readonly ring: Ring;
  /** Portion inside the right-of-way strip; null when the parcel is not affected. */
  readonly affectationRing: Ring | null;
}

export interface GeneratedCorridor {
  readonly generatorVersion: string;
  readonly alignment: ReadonlyArray<Position>;
  readonly alignmentLengthM: number;
  readonly parcels: ReadonlyArray<GeneratedParcel>;
}

/* ---------------------------------------------------------------------------------------------
 * Deterministic arithmetic
 * ------------------------------------------------------------------------------------------- */

/** FNV-1a: a stable 32-bit hash so a seed string maps to the same number on every machine. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, fully deterministic. Not cryptographic, and does not need to be. */
function createRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Local metric frame. Over a 7 km corridor an equirectangular approximation anchored at the first
 * control point is accurate to well under a metre, which is far below the precision synthetic
 * geometry claims. The result is transformed to the projected storage CRS by PostGIS anyway.
 */
function metricFrame(origin: Position) {
  const metresPerDegreeLat = 110_574;
  const metresPerDegreeLon = 111_320 * Math.cos((origin[1] * Math.PI) / 180);
  return {
    toMetres: (p: Position): Position => [
      (p[0] - origin[0]) * metresPerDegreeLon,
      (p[1] - origin[1]) * metresPerDegreeLat,
    ],
    toDegrees: (p: Position): Position => [
      origin[0] + p[0] / metresPerDegreeLon,
      origin[1] + p[1] / metresPerDegreeLat,
    ],
  };
}

function distance(a: Position, b: Position): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Point at `station` metres along a polyline, plus the unit tangent there. */
function stationOn(
  line: ReadonlyArray<Position>,
  cumulative: ReadonlyArray<number>,
  station: number,
): { point: Position; tangent: Position } {
  const total = cumulative[cumulative.length - 1] ?? 0;
  const target = Math.min(Math.max(station, 0), total);
  let i = 1;
  while (i < cumulative.length - 1 && (cumulative[i] ?? 0) < target) i++;
  const a = line[i - 1]!;
  const b = line[i]!;
  const segmentStart = cumulative[i - 1] ?? 0;
  const segmentLength = (cumulative[i] ?? 0) - segmentStart || 1;
  const t = (target - segmentStart) / segmentLength;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const norm = Math.hypot(dx, dy) || 1;
  return {
    point: [a[0] + dx * t, a[1] + dy * t],
    tangent: [dx / norm, dy / norm],
  };
}

function cumulativeLengths(line: ReadonlyArray<Position>): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1]! + distance(line[i - 1]!, line[i]!));
  return out;
}

/* ------------------------------------------------------------------------------------------- */

export function generateCorridor(rawInput: CorridorGeneratorInput): GeneratedCorridor {
  const input = corridorGeneratorInputSchema.parse(rawInput);
  const random = createRandom(input.seed);
  const origin = input.controlPoints[0]! as Position;
  const frame = metricFrame(origin);

  // 1 · the axis, in metres, resampled every 40 m with a gentle deterministic sinuosity.
  const controlMetres = input.controlPoints.map((p) => frame.toMetres(p as Position));
  const controlCumulative = cumulativeLengths(controlMetres);
  const controlLength = controlCumulative[controlCumulative.length - 1] ?? 0;
  const step = 40;
  const axis: Position[] = [];
  for (let s = 0; s <= controlLength; s += step) {
    const { point, tangent } = stationOn(controlMetres, controlCumulative, s);
    // Sideways wobble, smooth and bounded: two sine terms, never a random walk, so the axis is
    // continuous and the same every run.
    const wobble = Math.sin(s / 620) * 26 + Math.sin(s / 190 + 1.7) * 9;
    const normal: Position = [-tangent[1], tangent[0]];
    axis.push([point[0] + normal[0] * wobble, point[1] + normal[1] * wobble]);
  }
  const axisCumulative = cumulativeLengths(axis);
  const axisLength = axisCumulative[axisCumulative.length - 1] ?? 0;

  // 2 · statuses, assigned to deterministic positions rather than at random.
  const statuses = new Map<number, ParcelStatus>();
  const claim = (count: number, status: ParcelStatus, stride: number, offset: number) => {
    for (let k = 0; k < count; k++) {
      let index = (offset + k * stride) % input.parcelCount;
      while (statuses.has(index)) index = (index + 1) % input.parcelCount;
      statuses.set(index, status);
    }
  };
  claim(input.statusPlan.excluded, "excluded", 47, 11);
  claim(input.statusPlan.notLocated, "not_located", 31, 23);
  claim(input.statusPlan.estimated, "estimated", 17, 5);

  // 3 · sector boundaries as cumulative shares of the axis length.
  const totalShare = input.sectors.reduce((sum, s) => sum + s.share, 0) || 1;
  const sectorBounds: Array<{ label: string; upTo: number }> = [];
  let accumulated = 0;
  for (const sector of input.sectors) {
    accumulated += (sector.share / totalShare) * axisLength;
    sectorBounds.push({ label: sector.label, upTo: accumulated });
  }
  const sectorAt = (station: number) =>
    sectorBounds.find((b) => station <= b.upTo)?.label ??
    sectorBounds[sectorBounds.length - 1]!.label;

  // 4 · parcels along the axis, alternating sides.
  const usable = axisLength - input.frontageM;
  const spacing = usable / Math.max(1, input.parcelCount - 1);
  const parcels: GeneratedParcel[] = [];

  for (let i = 0; i < input.parcelCount; i++) {
    const chainage = input.frontageM / 2 + i * spacing;
    const side: ParcelSide = i % 2 === 0 ? "right" : "left";
    const sign = side === "right" ? -1 : 1;

    const frontage = input.frontageM * (0.72 + random() * 0.56);
    const depth = input.depthM * (0.65 + random() * 0.7);
    const half = frontage / 2;

    const near = stationOn(axis, axisCumulative, chainage - half);
    const far = stationOn(axis, axisCumulative, chainage + half);
    const normalAt = (t: Position): Position => [-t[1] * sign, t[0] * sign];
    const n1 = normalAt(near.tangent);
    const n2 = normalAt(far.tangent);

    const inner1: Position = [
      near.point[0] + n1[0] * input.setbackM,
      near.point[1] + n1[1] * input.setbackM,
    ];
    const inner2: Position = [
      far.point[0] + n2[0] * input.setbackM,
      far.point[1] + n2[1] * input.setbackM,
    ];
    const outer2: Position = [inner2[0] + n2[0] * depth, inner2[1] + n2[1] * depth];
    const outer1: Position = [inner1[0] + n1[0] * depth, inner1[1] + n1[1] * depth];
    const ring: Position[] = [inner1, inner2, outer2, outer1, inner1];

    // The right-of-way strip reaches `rightOfWayHalfWidthM` from the axis; a parcel set back
    // further than that is untouched, which is why some parcels have no affectation at all.
    const overlap = input.rightOfWayHalfWidthM - input.setbackM;
    const affectationRing: Position[] | null =
      overlap > 0
        ? [
            inner1,
            inner2,
            [
              inner2[0] + n2[0] * Math.min(overlap, depth),
              inner2[1] + n2[1] * Math.min(overlap, depth),
            ],
            [
              inner1[0] + n1[0] * Math.min(overlap, depth),
              inner1[1] + n1[1] * Math.min(overlap, depth),
            ],
            inner1,
          ]
        : null;

    parcels.push({
      parcelCode: `${input.codePrefix}-${String(i + 1).padStart(3, "0")}`,
      sectorLabel: sectorAt(chainage),
      side,
      status: statuses.get(i) ?? "confirmed",
      chainageM: Math.round(chainage),
      frontageM: Math.round(frontage * 10) / 10,
      ring: ring.map(frame.toDegrees),
      affectationRing: affectationRing?.map(frame.toDegrees) ?? null,
    });
  }

  return {
    generatorVersion: CORRIDOR_GENERATOR_VERSION,
    alignment: axis.map(frame.toDegrees),
    alignmentLengthM: Math.round(axisLength),
    parcels,
  };
}
