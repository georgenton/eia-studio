import { withDbContext, type Database } from "@eia/db";
import {
  milestonesFor,
  NotFound,
  requireCapability,
  type ChainageFrame,
  type Milestone,
  type RequestContext,
} from "@eia/domain";
import { sql } from "drizzle-orm";

/**
 * Measuring a road, and the three ways the audited code got it wrong.
 *
 * `corridor-intake.ts` derived a parcel's abscissa like this:
 *
 * ```sql
 * l as (select ST_GeometryN(a.geom, 1) as ln, g.c from a, g),
 * f as (select ln, c, ST_LineLocatePoint(ln, c) as t from l),
 * s as (select …, ST_Length(ST_Transform(ln, analysis_srid)) as len from f)
 * select round((t * len)::numeric, 1) as chainage
 * ```
 *
 * Three errors, compounding:
 *
 * 1. **`ST_GeometryN(geom, 1)`** — `app.alignment.geom` is a `MultiLineString` (migration 0024).
 *    A route delivered in two pieces is measured as its first piece, so every parcel past the join
 *    is projected onto a line that does not reach it and lands somewhere inside piece one.
 * 2. **A fraction taken in EPSG:4326.** `ST_LineLocatePoint` on a geographic geometry returns a
 *    fraction of the line's length *in degrees*, and a degree of longitude is not a degree of
 *    latitude. Near the equator the anisotropy is small, which is exactly why this survived: the
 *    answer looked plausible on the pilot's own corridor.
 * 3. **That fraction multiplied by a projected length.** A ratio measured in one space scaled by a
 *    distance measured in another is not a distance in either.
 *
 * On a single, short, roughly straight segment the three cancel out to something near enough to be
 * believed. That is the property of this defect that makes it worth a module of its own.
 *
 * ## What this does instead
 *
 * One transform, up front, into the dataset version's own `analysis_srid` — a projected code
 * recorded per dataset and never a zone inferred from the country (ADR-017). Then every
 * measurement happens in metres, on the **whole** route.
 *
 * ## What it refuses to do
 *
 * `ST_LineMerge` joins parts that touch end to end and leaves the rest alone. When the result is
 * still multi-part the delivery is a route with genuine gaps, or with branches, and this function
 * **says so and measures nothing**. Joining them would be inventing road: the gap between two
 * pieces would silently become length, every abscissa after it would shift by that amount, and a
 * kilometre post would be drawn where there is no road. A discontinuous delivery is a finding to
 * report to whoever produced it, not a defect to repair here.
 */
export type RouteMeasurement =
  | {
      readonly kind: "measured";
      /** Metres along the route, measured in the dataset version's projected analysis CRS. */
      readonly routeLengthM: number;
      /** The EPSG code the measurement was taken in. Shown on screen beside the figure. */
      readonly analysisSrid: number;
      /** How many parts the stored geometry had before merging. `1` for an ordinary delivery. */
      readonly partsBeforeMerge: number;
    }
  | {
      readonly kind: "discontinuous";
      /**
       * Parts that remain after merging what touches. More than one means the delivery cannot be
       * walked as a single route, so there is no single distance to measure along.
       */
      readonly partsAfterMerge: number;
      readonly analysisSrid: number;
    };

interface MeasureRow {
  parts_before: number;
  parts_after: number;
  length_m: string | number | null;
  analysis_srid: number;
}

export async function measureRoute(
  db: Database,
  ctx: RequestContext,
  datasetVersionId: string,
): Promise<RouteMeasurement> {
  requireCapability(ctx, "gis.maps");
  const projectId = requireProject(ctx);

  const row = await withDbContext(db, ctx, async (tx) => {
    const result = await tx.execute(sql`
      with v as (
        select id, analysis_srid
          from app.spatial_dataset_version
         where tenant_id = ${ctx.tenantId} and project_id = ${projectId}
           and id = ${datasetVersionId}
         limit 1
      ),
      a as (
        select al.geom, v.analysis_srid
          from app.alignment al
          join v on v.id = al.dataset_version_id
         where al.tenant_id = ${ctx.tenantId} and al.project_id = ${projectId}
         limit 1
      ),
      -- One transform, before anything is measured. Everything below is metres.
      m as (
        select ST_LineMerge(ST_Transform(geom, analysis_srid::integer)) as route,
               ST_NumGeometries(geom) as parts_before,
               analysis_srid
          from a
      )
      select parts_before::int as parts_before,
             coalesce(ST_NumGeometries(route), 1)::int as parts_after,
             case when GeometryType(route) = 'LINESTRING' then ST_Length(route) else null end
               as length_m,
             analysis_srid::int as analysis_srid
        from m
    `);
    return (result.rows[0] as unknown as MeasureRow | undefined) ?? null;
  });

  if (!row) throw new NotFound("alignment");

  /*
   * `ST_LineMerge` returns a LINESTRING when the parts formed one continuous route and a
   * MULTILINESTRING when they did not. The type is the answer, not the part count: a single-part
   * multi-geometry merges to a LINESTRING too, which is the ordinary case for a clean delivery.
   */
  if (row.length_m === null) {
    return {
      kind: "discontinuous",
      partsAfterMerge: Number(row.parts_after),
      analysisSrid: Number(row.analysis_srid),
    };
  }

  return {
    kind: "measured",
    routeLengthM: Number(row.length_m),
    analysisSrid: Number(row.analysis_srid),
    partsBeforeMerge: Number(row.parts_before),
  };
}

/**
 * The kilometre posts of a project's corridor, with the origin and direction it declared.
 *
 * The measurement comes from `measureRoute` — whole route, projected — and the posts from
 * `milestonesFor`, which is pure arithmetic over the declared frame. `declared` is the honest part:
 * when a project has not stated where its 0+000 is, the posts are **calculated distance from the
 * first vertex** rather than abscissas, and every surface that draws them has to say so.
 */
/** A kilometre post with the place it sits, in canonical EPSG:4326 for drawing. */
export interface PlacedMilestone extends Milestone {
  readonly longitude: number;
  readonly latitude: number;
}

export interface CorridorMilestones {
  readonly milestones: ReadonlyArray<PlacedMilestone>;
  /**
   * The ends of the merged route, in the order the geometry runs.
   *
   * `ST_LineMerge` may return the route reversed with respect to how it was delivered, and nothing
   * in the geometry says which end the abscissa starts at. So both ends are returned and the
   * caller — a surface, or whoever declares the frame — can see which one the declared origin is
   * being anchored to instead of trusting the merge's direction (block C.5).
   */
  readonly startPoint: { readonly longitude: number; readonly latitude: number };
  readonly endPoint: { readonly longitude: number; readonly latitude: number };
  readonly routeLengthM: number;
  readonly frame: ChainageFrame;
  /**
   * False when the origin and direction were assumed rather than declared. The labels are then a
   * calculated distance and must not be presented as the project's abscissado.
   */
  readonly declared: boolean;
  readonly analysisSrid: number;
}

export async function loadCorridorMilestones(
  db: Database,
  ctx: RequestContext,
  input: {
    readonly datasetVersionId: string;
    /** From the project's configuration when it has one; absent means "not declared". */
    readonly startChainageM?: number;
    readonly direction?: "forward" | "reverse";
    readonly spacingM?: number;
  },
): Promise<
  CorridorMilestones | { readonly kind: "discontinuous"; readonly partsAfterMerge: number }
> {
  const projectId = requireProject(ctx);
  const measurement = await measureRoute(db, ctx, input.datasetVersionId);
  if (measurement.kind === "discontinuous") {
    return { kind: "discontinuous", partsAfterMerge: measurement.partsAfterMerge };
  }

  const declared = input.startChainageM !== undefined && input.direction !== undefined;
  const frame: ChainageFrame = {
    routeLengthM: measurement.routeLengthM,
    startChainageM: input.startChainageM ?? 0,
    direction: input.direction ?? "forward",
  };

  const milestones = milestonesFor(frame, input.spacingM);

  /*
   * The places, interpolated on **the same metric route the length came from**.
   *
   * One query, with the distances passed in as an array, so every post is placed on the geometry
   * that produced the measurement rather than on a second reading of it. Interpolation happens in
   * the projected CRS — `ST_LineInterpolatePoint` takes a fraction of length, and a fraction of a
   * geographic line's length is a fraction of degrees — and the result is transformed back to
   * EPSG:4326, which is what every map in this product consumes (ADR-017).
   */
  const placed = await withDbContext(db, ctx, async (tx) => {
    const distances = milestones.map((m) => m.distanceAlongM);
    const result = await tx.execute(sql`
      with v as (
        select analysis_srid from app.spatial_dataset_version
         where tenant_id = ${ctx.tenantId} and project_id = ${projectId}
           and id = ${input.datasetVersionId}
         limit 1
      ),
      r as (
        select ST_LineMerge(ST_Transform(al.geom, v.analysis_srid::integer)) as route,
               v.analysis_srid
          from app.alignment al, v
         where al.tenant_id = ${ctx.tenantId} and al.project_id = ${projectId}
           and al.dataset_version_id = ${input.datasetVersionId}
         limit 1
      ),
      len as (select route, analysis_srid, ST_Length(route) as total from r),
      d as (
        select ordinality - 1 as idx, value::double precision as distance_m
          from unnest(${sql.raw(`ARRAY[${distances.map((x) => Number(x)).join(",") || "NULL::double precision"}]::double precision[]`)})
               with ordinality as t(value, ordinality)
      )
      select d.idx,
             ST_X(ST_Transform(ST_LineInterpolatePoint(len.route,
               least(greatest(d.distance_m / nullif(len.total, 0), 0), 1)), 4326)) as lon,
             ST_Y(ST_Transform(ST_LineInterpolatePoint(len.route,
               least(greatest(d.distance_m / nullif(len.total, 0), 0), 1)), 4326)) as lat,
             ST_X(ST_Transform(ST_StartPoint(len.route), 4326)) as start_lon,
             ST_Y(ST_Transform(ST_StartPoint(len.route), 4326)) as start_lat,
             ST_X(ST_Transform(ST_EndPoint(len.route), 4326)) as end_lon,
             ST_Y(ST_Transform(ST_EndPoint(len.route), 4326)) as end_lat
        from d, len
       order by d.idx
    `);
    return result.rows as unknown as ReadonlyArray<{
      idx: number;
      lon: number | string;
      lat: number | string;
      start_lon: number | string;
      start_lat: number | string;
      end_lon: number | string;
      end_lat: number | string;
    }>;
  });

  const ends = placed[0];
  if (ends === undefined) throw new NotFound("alignment");

  return {
    milestones: milestones.map((m, index) => {
      const row = placed.find((r) => Number(r.idx) === index);
      if (row === undefined) throw new NotFound("milestone placement");
      return { ...m, longitude: Number(row.lon), latitude: Number(row.lat) };
    }),
    startPoint: { longitude: Number(ends.start_lon), latitude: Number(ends.start_lat) },
    endPoint: { longitude: Number(ends.end_lon), latitude: Number(ends.end_lat) },
    routeLengthM: measurement.routeLengthM,
    frame,
    declared,
    analysisSrid: measurement.analysisSrid,
  };
}

function requireProject(ctx: RequestContext): string {
  if (ctx.projectId === null) throw new NotFound("this action needs a project context");
  return ctx.projectId;
}
