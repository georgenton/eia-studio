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
  type FieldMapResponse,
  type MapMilestone,
  type MapParcel,
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
}

interface ParcelRow {
  assignment_id: string;
  parcel_code: string;
  chainage_m: string | number | null;
  side: string | null;
  /** A `json` column: the driver hands it back already parsed. */
  ring: unknown;
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

export async function loadFieldMap(
  db: Database,
  ctx: RequestContext,
  scope: FieldMapScope = {},
): Promise<FieldMapResponse> {
  requireCapability(ctx, "gis.maps");
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.assignments.read_own");
  const projectId = ctx.projectId;
  if (projectId === null) throw new NotFound("this action needs a project context");

  const axisVertexLimit = scope.axisVertexLimit ?? 1_500;

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
             case
               when g.geom is null then null
               else ST_AsGeoJSON(
                      ST_Transform(
                        ST_SimplifyPreserveTopology(
                          ST_ExteriorRing(
                            ST_GeometryN(ST_Transform(g.geom, v.analysis_srid::integer), 1)),
                          1.0),
                        4326))::json -> 'coordinates'
             end as ring,
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
      select label, dataset_version_label, origin, condition, dataset_version_id,
             case
               when GeometryType(route) <> 'LINESTRING' then null
               else ST_AsGeoJSON(
                      ST_Transform(ST_SimplifyPreserveTopology(route, 5.0), 4326))::json
                      -> 'coordinates'
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

  const mapParcels: MapParcel[] = [];
  for (const row of parcels) {
    const ring = positionsFrom(row.ring);
    const point = positionFrom(row.point);
    /*
     * A boundary when there is one, a reference point when there is not — and nothing at all when
     * the parcel has no geometry. A parcel the cartography cannot place is left out of the map
     * rather than pinned somewhere plausible; the technician still has it in their work list, with
     * its code and its abscissa.
     */
    if (ring.length >= 4) {
      mapParcels.push({
        assignmentId: row.assignment_id,
        parcelCode: row.parcel_code,
        chainageLabel: row.chainage_m === null ? null : formatChainage(Number(row.chainage_m)),
        side: (row.side as MapParcel["side"]) ?? null,
        place: { kind: "polygon", ring: [...ring] },
      });
      continue;
    }
    if (point !== null) {
      mapParcels.push({
        assignmentId: row.assignment_id,
        parcelCode: row.parcel_code,
        chainageLabel: row.chainage_m === null ? null : formatChainage(Number(row.chainage_m)),
        side: (row.side as MapParcel["side"]) ?? null,
        place: { kind: "reference_point", at: point },
      });
    }
  }

  const axisCoordinates = positionsFrom(axis?.coordinates);

  return {
    schemaVersion: FIELD_MAP_SCHEMA_VERSION,
    projectName,
    generatedAt: new Date().toISOString(),
    provenance: {
      datasetVersionLabel: axis?.dataset_version_label ?? "sin cartografía activa",
      origin: axis?.origin ?? "none",
      condition: conditionFrom(axis?.condition ?? null),
    },
    axis:
      axis !== null && axisCoordinates.length >= 2
        ? {
            label: axis.label,
            coordinates: [...axisCoordinates].slice(0, axisVertexLimit),
          }
        : null,
    chainageDeclared,
    milestones: [...milestones],
    parcels: mapParcels,
  };
}
