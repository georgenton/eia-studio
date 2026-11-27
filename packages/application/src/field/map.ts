import { type Database } from "@eia/db";
import {
  formatChainage,
  NotFound,
  requireCapability,
  requirePermission,
  type RequestContext,
} from "@eia/domain";
import {
  FIELD_MAP_SCHEMA_VERSION,
  FIELD_MAP_SCHEMA_VERSION_PARTS,
  type FieldMapResponse,
  type FieldMapResponseV2,
  type MapMilestone,
  type MapParcel,
  type MapParcelPart,
  type MapParcelV2,
  type MapPosition,
} from "@eia/field-sync-contract";
import { sql } from "drizzle-orm";

import { loadCorridorMilestones } from "../gis/route-measure";

import { withFieldContext } from "./context";

/**
 * The cartography a technician's device may download, scoped to the work that technician holds.
 *
 * ## The scope, and where it is enforced
 *
 * `field.assignments.read_own` is the grant, and the row-level policy on `app.field_assignment` is
 * what actually decides: *this row is mine, or I hold `field.responses.read`*. A technician holds
 * neither `field.read` nor `field.responses.read`, so the query below returns their own
 * assignments because the policy says so — not because of the `assignee_user_id` predicate, which
 * is the second layer and is there for the same reason every repository predicate is (TENANCY.md
 * §4).
 *
 * The consequence worth stating: a device asking for this cannot learn which parcels another
 * technician was given, how many there are, or where they are. Nothing is filtered out of a larger
 * answer — the larger answer is never assembled.
 *
 * ## What cannot be in it
 *
 * There is no field in `fieldMapResponseSchema` for a survey answer, a respondent, an owner, a
 * household's position, a photograph, another technician, or a parcel this technician was not
 * given. That is a property of the schema rather than of this function, which is the point: a
 * later change that wanted to add one would have to say so in the contract.
 *
 * ## The axis, and when it is absent
 *
 * One continuous line or nothing. A delivery whose pieces do not meet has no single route — see
 * `measureRoute` — and sending the fragments would let a phone draw a road across a gap that is
 * not there. `axis: null` with the parcels still present is the honest shape: a technician can
 * still find their parcels, and the corridor is simply not drawn.
 */
export interface FieldMapScope {
  /** Points on the axis, at most this many after simplification, so a phone can draw it. */
  readonly axisVertexLimit?: number;
  /**
   * The highest response version the caller can parse. Defaults to 1, which is what a build that
   * predates `parts` is holding — and giving it anything else would be a parse error.
   */
  readonly acceptsSchemaVersion?: number;
  /**
   * Where the device may fetch reference imagery, when the deployment has a key for it.
   *
   * Passed in by the route rather than read here: this module knows about the study's geometry,
   * and which third-party service a deployment happens to have configured is not its business.
   */
  readonly referenceBasemap?: {
    readonly tileUrl: string;
    readonly attribution: string;
    readonly maxZoom: number;
  } | null;
}

interface ParcelRow {
  assignment_id: string;
  parcel_code: string;
  chainage_m: string | number | null;
  side: string | null;
  /** A `json` column: the driver hands it back already parsed. */
  /** The whole parcel as GeoJSON: `Polygon` or `MultiPolygon`, already simplified. */
  shape: unknown;
  point: unknown;
}

interface AxisRow {
  label: string;
  dataset_version_label: string;
  origin: string;
  condition: string | null;
  dataset_version_id: string;
  coordinates: unknown;
}

/**
 * GeoJSON `coordinates` as PostGIS returns them, narrowed to what the contract accepts.
 *
 * The driver parses a `json` column for us, so this takes `unknown` and checks rather than parsing
 * a string: a value that is already an array arrives as one. Anything that is not a pair of finite
 * numbers is dropped instead of being coerced — a coordinate this function could not read is a
 * coordinate the device must not be handed.
 */
function positionsFrom(value: unknown): ReadonlyArray<MapPosition> {
  if (!Array.isArray(value)) return [];
  const out: MapPosition[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [lon, lat] = entry as [unknown, unknown];
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push([lon, lat]);
  }
  return out;
}

/**
 * The delivery's declared condition, out of the dataset version's note.
 *
 * `spatial_dataset_version.note` is not a sentence: the corridor importer writes a JSON record of
 * the contract into it — the source hashes, the feature count, the condition. Sending it whole as
 * `condition` put a three-hundred-character blob into a forty-character field, and the device's
 * `.strict()` schema **rejected the entire map**. Observed on the emulator, which is the only place
 * it could be observed: the server was perfectly happy producing it.
 *
 * So the one field a technician can act on is extracted, and anything else — a note somebody typed
 * by hand, a record from a different importer version, no note at all — reads as null rather than
 * being truncated into something that looks like a declaration.
 */
function conditionFrom(note: string | null): string | null {
  if (note === null) return null;
  try {
    const parsed = JSON.parse(note) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const condition = (parsed as { condition?: unknown }).condition;
    if (typeof condition !== "string") return null;
    const trimmed = condition.trim();
    return trimmed.length > 0 && trimmed.length <= 40 ? trimmed : null;
  } catch {
    return null;
  }
}

/** A single GeoJSON position, for `ST_PointOnSurface`. */
function positionFrom(value: unknown): MapPosition | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [lon, lat] = value as [unknown, unknown];
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

/**
 * Every piece of a parcel, with its holes, out of a GeoJSON `Polygon` or `MultiPolygon`.
 *
 * A ring that does not survive `positionsFrom` — fewer than four usable positions — is dropped,
 * and a *part* whose outer ring is dropped goes with it. That is the one place a piece can be
 * lost, and it can only happen to a ring the database could not express as coordinates, which is
 * not a parcel anybody can be sent to.
 */
function partsFrom(shape: unknown): ReadonlyArray<MapParcelPart> {
  if (typeof shape !== "object" || shape === null) return [];
  const geometry = shape as { type?: string; coordinates?: unknown };
  const polygons: unknown[] =
    geometry.type === "MultiPolygon"
      ? ((geometry.coordinates as unknown[]) ?? [])
      : geometry.type === "Polygon"
        ? [geometry.coordinates]
        : [];

  const parts: MapParcelPart[] = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;
    const outer = positionsFrom(polygon[0]);
    if (outer.length < 4) continue;
    const holes = polygon
      .slice(1)
      .map((ring) => positionsFrom(ring))
      .filter((ring) => ring.length >= 4)
      .map((ring) => [...ring]);
    parts.push({ outer: [...outer], holes });
  }
  return parts;
}

/**
 * Twice the signed area of a ring. Only its magnitude is used, and only to compare pieces.
 *
 * In degrees, which is wrong as an area and right as a comparison: over one parcel the scale
 * factor between degrees and metres is the same for every piece, so the largest piece in degrees
 * is the largest piece on the ground. Nothing is reported from this number.
 */
function ringMagnitude(ring: ReadonlyArray<MapPosition>): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum);
}

/** The version 1 ring: the outer ring of the **largest** piece, not of the first one. */
function largestOuterRing(parts: ReadonlyArray<MapParcelPart>): ReadonlyArray<MapPosition> | null {
  let best: ReadonlyArray<MapPosition> | null = null;
  let bestArea = -1;
  for (const part of parts) {
    const area = ringMagnitude(part.outer);
    if (area > bestArea) {
      bestArea = area;
      best = part.outer;
    }
  }
  return best;
}

/**
 * Bring a line under a vertex ceiling **without losing either end**.
 *
 * The SQL already simplifies by a tolerance derived from the route's length, which is enough for
 * any road this product has seen. This is the guarantee behind it: a pathologically wiggly line
 * is decimated at a uniform stride, and the first and last positions are always kept — so the
 * road is coarser and still runs the whole way, which is the opposite of taking the first N
 * vertices and dropping the tail.
 */
function withinVertexLimit(
  positions: ReadonlyArray<MapPosition>,
  limit: number,
): ReadonlyArray<MapPosition> {
  if (positions.length <= limit || limit < 2) return positions;
  const stride = Math.ceil(positions.length / (limit - 1));
  const kept: MapPosition[] = [];
  for (let i = 0; i < positions.length; i += stride) kept.push(positions[i]!);
  const last = positions[positions.length - 1]!;
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

export async function loadFieldMap(
  db: Database,
  ctx: RequestContext,
  scope: FieldMapScope = {},
): Promise<FieldMapResponse | FieldMapResponseV2> {
  requireCapability(ctx, "gis.maps");
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.assignments.read_own");
  const projectId = ctx.projectId;
  if (projectId === null) throw new NotFound("this action needs a project context");

  const axisVertexLimit = scope.axisVertexLimit ?? 1_500;
  const acceptsVersion = scope.acceptsSchemaVersion ?? FIELD_MAP_SCHEMA_VERSION;

  const { parcels, axis, projectName } = await withFieldContext(db, ctx, async (tx) => {
    const named = await tx.execute(sql`
      select name from app.project
       where tenant_id = ${ctx.tenantId} and id = ${projectId} limit 1
    `);
    const project = named.rows[0] as unknown as { name: string } | undefined;
    if (project === undefined) throw new NotFound("project");

    /*
     * The caller's own assignments, and the geometry of their parcels.
     *
     * `ST_ExteriorRing` and no holes: a phone draws an outline, and a parcel with an interior ring
     * is a cartographic nicety a technician standing in front of it does not need. The polygon is
     * simplified in the **projected** CRS the dataset declares, because a tolerance in degrees is
     * a different distance at every latitude; 1 m is below what a handset's own position can
     * resolve, so the outline is not visibly coarser.
     *
     * `ST_PointOnSurface` rather than `ST_Centroid` for the fallback: a centroid can fall outside
     * a concave parcel, and a reference point that is not inside the parcel is worse than none.
     */
    const parcelRows = await tx.execute(sql`
      select fa.id as assignment_id,
             p.parcel_code,
             p.chainage_m,
             p.side::text as side,
             /*
              * The **whole** parcel, every piece and every hole, simplified in the dataset's
              * projected CRS so the tolerance is a metre on the ground rather than a degree.
              *
              * This used to be ST_ExteriorRing(ST_GeometryN(..., 1)): the outer ring of whichever
              * piece the cartography happened to store first. Twenty of the study's 141 parcels
              * are multi-part, so a technician could be shown one piece as though it were the
              * parcel — and a hole, a right of way or an excluded plot, was drawn as solid
              * ground. Neither is a rounding error.
              *
              * ST_SimplifyPreserveTopology cannot invert a ring or cross it, so a simplified
              * hole is still inside its outer ring. The rings are handed on as GeoJSON and split
              * into parts by the caller.
              */
             case
               when g.geom is null then null
               else ST_AsGeoJSON(
                      ST_Transform(
                        ST_SimplifyPreserveTopology(
                          ST_Transform(g.geom, v.analysis_srid::integer),
                          1.0),
                        4326))::json
             end as shape,
             case
               when g.geom is null then null
               else ST_AsGeoJSON(ST_PointOnSurface(g.geom))::json -> 'coordinates'
             end as point
        from app.field_assignment fa
        join app.parcel p on p.tenant_id = fa.tenant_id and p.id = fa.parcel_id
        left join app.parcel_geometry g
          on g.tenant_id = p.tenant_id and g.parcel_id = p.id and g.is_active
        left join app.spatial_dataset_version v
          on v.tenant_id = g.tenant_id and v.id = g.dataset_version_id
       where fa.tenant_id = ${ctx.tenantId} and fa.project_id = ${projectId}
         and fa.assignee_user_id = ${ctx.userId}
         and fa.status <> 'CANCELLED'
       order by p.parcel_code
       limit 200
    `);

    /*
     * The active axis, simplified for a screen. `ST_LineMerge` first, so a delivery in pieces that
     * meet is one line; a delivery with a gap stays multi-part and `GeometryType` filters it out,
     * which is how `axis` becomes null rather than a drawn fiction.
     */
    const axisRows = await tx.execute(sql`
      with a as (
        select al.label, al.dataset_version_id,
               v.version_label as dataset_version_label,
               v.origin::text as origin,
               v.note as condition,
               ST_LineMerge(ST_Transform(al.geom, v.analysis_srid::integer)) as route
          from app.alignment al
          join app.spatial_dataset_version v
            on v.tenant_id = al.tenant_id and v.id = al.dataset_version_id and v.is_active
         where al.tenant_id = ${ctx.tenantId} and al.project_id = ${projectId}
         limit 1
      )
      /*
       * The whole road, coarser — never the first N vertices of it.
       *
       * The tolerance is derived from the route's own length and the vertex ceiling, so a long
       * road is simplified harder and a short one is barely touched, and **both arrive complete**.
       * The previous version simplified at a fixed 5 m and then took slice(0, limit), which cut
       * the tail off: a parcel at the far end of a 5,9 km corridor had its stretch of road simply
       * missing, with nothing on the device saying so.
       *
       * At least 5 m, because below that the simplification is not worth the vertices.
       */
      select label, dataset_version_label, origin, condition, dataset_version_id,
             case
               when GeometryType(route) <> 'LINESTRING' then null
               else ST_AsGeoJSON(
                      ST_Transform(
                        ST_SimplifyPreserveTopology(
                          route,
                          greatest(5.0, ST_Length(route) / ${sql.raw(String(axisVertexLimit))})),
                        4326))::json -> 'coordinates'
             end as coordinates
        from a
    `);

    return {
      projectName: project.name,
      parcels: (parcelRows.rows ?? []) as unknown as ReadonlyArray<ParcelRow>,
      axis: (axisRows.rows[0] ?? null) as unknown as AxisRow | null,
    };
  });

  /*
   * The kilometre posts, from the same module the desk uses. No origin is declared anywhere yet, so
   * `chainageDeclared` is false and the device has to call them a calculated distance — which is
   * exactly what `loadCorridorMilestones` reports rather than something this function decides.
   */
  let milestones: ReadonlyArray<MapMilestone> = [];
  let chainageDeclared = false;
  if (axis !== null) {
    const posts = await loadCorridorMilestones(db, ctx, {
      datasetVersionId: axis.dataset_version_id,
    });
    if ("milestones" in posts) {
      chainageDeclared = posts.declared;
      milestones = posts.milestones.map((m) => ({
        label: m.label,
        at: [m.longitude, m.latitude] as MapPosition,
      }));
    }
  }

  const mapParcels: MapParcelV2[] = [];
  for (const row of parcels) {
    const parts = partsFrom(row.shape);
    const ring = largestOuterRing(parts);
    const point = positionFrom(row.point);
    /*
     * A boundary when there is one, a reference point when there is not — and nothing at all when
     * the parcel has no geometry. A parcel the cartography cannot place is left out of the map
     * rather than pinned somewhere plausible; the technician still has it in their work list, with
     * its code and its abscissa.
     */
    const common = {
      assignmentId: row.assignment_id,
      parcelCode: row.parcel_code,
      chainageLabel: row.chainage_m === null ? null : formatChainage(Number(row.chainage_m)),
      side: (row.side as MapParcel["side"]) ?? null,
    };
    if (ring !== null && parts.length > 0) {
      mapParcels.push({
        ...common,
        place: { kind: "polygon", ring: [...ring], parts: [...parts] },
      });
      continue;
    }
    if (point !== null) {
      mapParcels.push({ ...common, place: { kind: "reference_point", at: point } });
    }
  }

  const axisCoordinates = withinVertexLimit(positionsFrom(axis?.coordinates), axisVertexLimit);

  const body = {
    projectName,
    generatedAt: new Date().toISOString(),
    provenance: {
      datasetVersionLabel: axis?.dataset_version_label ?? "sin cartografía activa",
      origin: axis?.origin ?? "none",
      condition: conditionFrom(axis?.condition ?? null),
    },
    axis:
      axis !== null && axisCoordinates.length >= 2
        ? { label: axis.label, coordinates: [...axisCoordinates] }
        : null,
    chainageDeclared,
    milestones: [...milestones],
  };

  /*
   * The version the caller can read, and nothing newer.
   *
   * A build that predates `parts` holds a `.strict()` schema pinned to `schemaVersion: 1`; giving
   * it the richer body would be a parse error and no map at all. So the extra field is **removed**
   * for such a caller, which leaves byte-for-byte what it gets today — and the version 1 `ring` is
   * now the largest piece rather than the first, which is the one improvement an old build gets
   * for free.
   */
  if (acceptsVersion >= FIELD_MAP_SCHEMA_VERSION_PARTS) {
    return {
      ...body,
      schemaVersion: FIELD_MAP_SCHEMA_VERSION_PARTS,
      parcels: mapParcels,
      referenceBasemap: scope.referenceBasemap ?? null,
    };
  }
  return {
    ...body,
    schemaVersion: FIELD_MAP_SCHEMA_VERSION,
    parcels: mapParcels.map(({ place, ...rest }) =>
      place.kind === "polygon"
        ? { ...rest, place: { kind: "polygon" as const, ring: place.ring } }
        : { ...rest, place },
    ),
  };
}
