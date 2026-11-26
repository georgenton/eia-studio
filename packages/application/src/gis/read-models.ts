import { gisSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  CANONICAL_SRID,
  affectationRatio,
  collectPositions,
  deriveLayerLegend,
  extendBounds,
  geometryBounds,
  NotFound,
  requireCapability,
  requirePermission,
  unionBounds,
  type AffectationCategory,
  type ChainageMethod,
  type LayerProvenanceLegend,
  type ParcelSide,
  type ParcelStatus,
  type ProvenanceFacets,
  type RequestContext,
  type SpatialDatasetKind,
  type SpatialDatasetOrigin,
} from "@eia/domain";
import { and, eq, sql } from "drizzle-orm";

import { facetsOf, loadProvenanceRecords } from "../projects/provenance";

/**
 * GIS read models (design v0.2 §3). The browser never issues spatial SQL: it receives a
 * project-scoped payload built here, under the verified RequestContext.
 *
 * Three rules hold throughout:
 *
 * - **Scope comes from the context, never from the request.** Every query filters on
 *   `ctx.tenantId` and `ctx.projectId`, and RLS denies the row a second time, so a forged
 *   project id returns nothing rather than another project's geometry.
 * - **No user-supplied SQL.** There is no bbox parameter, no filter expression and no column
 *   list on the wire. Filtering and sorting happen in the browser over a bounded payload.
 * - **Bounded results.** The payload is capped; a project that outgrows the cap gets tiles, not
 *   a bigger response (see `PARCEL_PAYLOAD_LIMIT`).
 */

/**
 * Maximum parcels returned as one GeoJSON payload. The pilot has 141, whose geometry serialises
 * to ~21 KiB, so a project payload is the right shape today. The trigger for moving to vector
 * tiles is this limit being reached, not a preference: see docs/SLICE_2_REPORT.md.
 */
export const PARCEL_PAYLOAD_LIMIT = 2000;

export interface LayerProvenance {
  readonly legend: LayerProvenanceLegend;
  readonly datasetKind: SpatialDatasetKind;
  readonly versionLabel: string;
  readonly origin: SpatialDatasetOrigin;
  /** EPSG code the geometry arrived in, before the transform to canonical storage. */
  readonly sourceSrid: number;
  /** Projected EPSG code this dataset's lengths and areas were measured in. */
  readonly analysisSrid: number;
  readonly generatorVersion: string | null;
  readonly featureCount: number;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}

/**
 * A point inside the parcel, in both coordinate systems, for a reader who has to go there.
 *
 * ## Why `ST_PointOnSurface` and not a centroid
 *
 * A centroid of a concave or multi-part parcel can fall outside every one of its rings — 20 of the
 * study's 141 parcels are multi-part — and a reference point that is not in the parcel is worse
 * than none at all. `ST_PointOnSurface` is guaranteed to be inside the geometry.
 *
 * ## Why both CRS, and why the projected one comes from the database
 *
 * The geographic pair is what the map draws and what a phone's GPS speaks. The projected pair is
 * what a total station, a field GPS and the study's own drawings speak, and it is the one a
 * cartographer can check against the delivered cartography. The transform is PostGIS's, into the
 * **dataset version's own** `analysis_srid`: the browser does not reproject anything, so there is
 * no second implementation of a coordinate transform to disagree with the first.
 *
 * It is a point *in* the parcel, not the parcel's location in any surveyed sense, and the surface
 * that shows it says so. It is also not anybody's house: the parcel polygon is cartography, and a
 * household's position is `pii` and is not in this read model at all.
 */
export interface ParcelReferencePoint {
  readonly lon: number;
  readonly lat: number;
  readonly easting: number;
  readonly northing: number;
  /** The CRS the easting and northing are in — the dataset version's, never a constant. */
  readonly analysisSrid: number;
}

export interface ParcelRow {
  readonly id: string;
  readonly parcelCode: string;
  readonly sectorLabel: string | null;
  readonly side: ParcelSide;
  readonly status: ParcelStatus;
  readonly chainageM: number | null;
  readonly chainageMethod: ChainageMethod | null;
  readonly frontageM: number | null;
  readonly areaM2: number | null;
  readonly affectedAreaM2: number | null;
  readonly affectationRatio: number | null;
  /** Null when the parcel has no active geometry: a parcel the cartography cannot place. */
  readonly referencePoint: ParcelReferencePoint | null;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}

/** GeoJSON, produced by PostGIS in the presentation CRS. Never the canonical storage. */
export interface ParcelFeature {
  readonly type: "Feature";
  readonly id: string;
  readonly geometry: unknown;
  readonly properties: {
    readonly parcelId: string;
    readonly parcelCode: string;
    readonly status: ParcelStatus;
  };
}

export interface ParcelExplorerView {
  readonly alignment: {
    readonly label: string;
    readonly lengthM: number;
    readonly geometry: unknown;
    readonly provenanceId: string;
    readonly provenance: ProvenanceFacets;
  } | null;
  readonly parcels: ReadonlyArray<ParcelRow>;
  readonly features: ReadonlyArray<ParcelFeature>;
  /**
   * The areas of influence the study delimited, **simplified for drawing** (TD-070).
   *
   * They are the context a parcel sits in — a consultant reads a corridor against them — and until
   * now they were imported, legended and invisible. The stored geometry is untouched: these are
   * a presentation copy, generalised in the dataset's own analysis CRS so the tolerance is metres
   * on the ground rather than degrees, and the surface says the drawn outline is generalised.
   * Without it the indirect social area alone is 585 KB of coordinates on every page load.
   */
  readonly influenceAreas: ReadonlyArray<InfluenceAreaFeature>;
  readonly layers: ReadonlyArray<LayerProvenance>;
  /**
   * Where the map opens, in presentation CRS: `[w, s, e, n]` over the **parcels and the
   * centreline** — the object of the work. The areas of influence are context and are left out,
   * because the indirect social one is five times the corridor and framing it hides what a reader
   * came to look at. `null` only when the project has no drawable geometry at all.
   */
  readonly bounds: readonly [number, number, number, number] | null;
  readonly truncated: boolean;
}

export interface InfluenceAreaFeature {
  readonly kind: string;
  readonly label: string;
  readonly areaHa: number;
  readonly geometry: unknown;
  readonly provenanceId: string;
}

/**
 * How much detail a drawn outline keeps, in metres of the dataset's analysis CRS.
 *
 * Interpolated with `sql.raw` rather than bound: PostGIS resolves `ST_SimplifyPreserveTopology`
 * and `ST_Transform` by argument type, and an untyped bind parameter makes the overload
 * ambiguous. Both values are constants of this module, never anything a caller supplies.
 */
const INFLUENCE_AREA_SIMPLIFY_M = 12;

function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

async function loadLayers(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
): Promise<LayerProvenance[]> {
  const rows = await tx
    .select({
      kind: gisSchema.spatialDataset.kind,
      versionLabel: gisSchema.spatialDatasetVersion.versionLabel,
      origin: gisSchema.spatialDatasetVersion.origin,
      sourceSrid: gisSchema.spatialDatasetVersion.sourceSrid,
      analysisSrid: gisSchema.spatialDatasetVersion.analysisSrid,
      generatorVersion: gisSchema.spatialDatasetVersion.generatorVersion,
      featureCount: gisSchema.spatialDatasetVersion.featureCount,
      provenanceId: gisSchema.spatialDatasetVersion.provenanceId,
    })
    .from(gisSchema.spatialDatasetVersion)
    .innerJoin(
      gisSchema.spatialDataset,
      and(
        eq(gisSchema.spatialDataset.tenantId, gisSchema.spatialDatasetVersion.tenantId),
        eq(gisSchema.spatialDataset.id, gisSchema.spatialDatasetVersion.datasetId),
      ),
    )
    .where(
      and(
        eq(gisSchema.spatialDatasetVersion.tenantId, ctx.tenantId),
        eq(gisSchema.spatialDatasetVersion.projectId, projectId),
        eq(gisSchema.spatialDatasetVersion.isActive, true),
      ),
    )
    // Ordered on purpose: the legend and the territorial summary read this list, and an
    // unordered query put whichever layer the database returned first under a panel that
    // summarises parcels.
    .orderBy(gisSchema.spatialDataset.kind, gisSchema.spatialDatasetVersion.versionLabel);

  const provenance = await loadProvenanceRecords(
    tx,
    ctx,
    rows.map((r) => r.provenanceId),
  );
  return rows.map((row) => {
    const record = provenance.get(row.provenanceId);
    if (!record) throw new Error("provenance record missing for an active dataset version");
    const facets = facetsOf(record);
    return {
      legend: deriveLayerLegend(row.kind, facets),
      datasetKind: row.kind,
      versionLabel: row.versionLabel,
      origin: row.origin,
      sourceSrid: row.sourceSrid,
      analysisSrid: row.analysisSrid,
      generatorVersion: row.generatorVersion,
      featureCount: row.featureCount,
      provenanceId: row.provenanceId,
      provenance: facets,
    };
  });
}

/**
 * The five columns that make a reference point, or nothing.
 *
 * All or none: a parcel with no active geometry has no point, and a row whose transform produced
 * a non-finite value — which is what a CRS mismatch looks like coming out of PostGIS — is reported
 * as *absent* rather than as a coordinate nobody can stand on. Absence is a state this product
 * already renders honestly; a NaN in a field a technician would navigate to is not.
 */
function referencePointOf(row: {
  analysis_srid: number | null;
  ref_lon: number | null;
  ref_lat: number | null;
  ref_easting: number | null;
  ref_northing: number | null;
}): ParcelReferencePoint | null {
  const { analysis_srid: srid, ref_lon: lon, ref_lat: lat } = row;
  const { ref_easting: easting, ref_northing: northing } = row;
  if (srid === null || lon === null || lat === null || easting === null || northing === null) {
    return null;
  }
  const values = [lon, lat, easting, northing].map(Number);
  if (values.some((v) => !Number.isFinite(v))) return null;
  const [lonN, latN, eastingN, northingN] = values as [number, number, number, number];
  return { lon: lonN, lat: latN, easting: eastingN, northing: northingN, analysisSrid: srid };
}

/**
 * Everything the GIS / Parcel Explorer needs, in one project-scoped payload: the table rows, the
 * map features and the layer provenance the legend is derived from.
 */
export async function loadParcelExplorer(
  db: Database,
  ctx: RequestContext,
): Promise<ParcelExplorerView> {
  requireCapability(ctx, "gis.maps");
  requireCapability(ctx, "gis.parcels");
  requirePermission(ctx, "parcels.read");
  if (ctx.projectId === null) throw new Error("loadParcelExplorer requires a project context");
  const projectId = ctx.projectId;

  return withDbContext(db, ctx, async (tx) => {
    const layers = await loadLayers(tx, ctx, projectId);

    const alignmentRows = await tx.execute(sql`
      select a.label,
             a.length_m,
             a.provenance_id,
             ST_AsGeoJSON(a.geom, 6) as geojson
      from app.alignment a
      join app.spatial_dataset_version v
        on v.tenant_id = a.tenant_id and v.id = a.dataset_version_id and v.is_active
      where a.tenant_id = ${ctx.tenantId} and a.project_id = ${projectId}
      limit 1
    `);

    /*
     * The areas of influence, generalised for display only.
     *
     * `ST_SimplifyPreserveTopology` in the dataset's analysis CRS, then back to the storage CRS:
     * a metre tolerance is meaningless in degrees, and a simplification that produced a
     * self-intersecting ring would be worse than no outline at all. Nothing is written; the stored
     * polygon is the one the study delivered.
     */
    const influenceRows = await tx.execute(sql`
      select ia.kind::text as kind,
             ia.label,
             ia.area_m2,
             ia.provenance_id,
             ST_AsGeoJSON(
               ST_Transform(
                 ST_SimplifyPreserveTopology(
                   ST_Transform(ia.geom, v.analysis_srid),
                   ${sql.raw(String(INFLUENCE_AREA_SIMPLIFY_M))}
                 ),
                 ${sql.raw(String(CANONICAL_SRID))}
               ),
               5
             ) as geojson
        from app.influence_area ia
        join app.spatial_dataset_version v
          on v.tenant_id = ia.tenant_id and v.id = ia.dataset_version_id and v.is_active
       where ia.tenant_id = ${ctx.tenantId} and ia.project_id = ${projectId}
       order by ia.area_m2
    `);

    // One query for the table and the map: the same rows, so a parcel can never be on the map
    // and missing from the table (the table is the accessible representation of the map).
    const parcelRows = await tx.execute(sql`
      select p.id,
             p.parcel_code,
             p.sector_label,
             p.side,
             p.status,
             p.chainage_m,
             p.chainage_method,
             p.frontage_m,
             p.provenance_id,
             g.area_m2,
             agg.affected_area_m2,
             ST_AsGeoJSON(g.geom, 6) as geojson,
             /*
              * A point inside the parcel, in the storage CRS and in the dataset's analysis CRS.
              * Both transforms happen here so the browser never reprojects: a second
              * implementation of a coordinate transform is a second thing that can be wrong.
              */
             gv.analysis_srid,
             ST_X(ST_PointOnSurface(g.geom)) as ref_lon,
             ST_Y(ST_PointOnSurface(g.geom)) as ref_lat,
             ST_X(ST_Transform(ST_PointOnSurface(g.geom), gv.analysis_srid)) as ref_easting,
             ST_Y(ST_Transform(ST_PointOnSurface(g.geom), gv.analysis_srid)) as ref_northing
      from app.parcel p
      left join app.parcel_geometry g
        on g.tenant_id = p.tenant_id and g.parcel_id = p.id and g.is_active
      left join app.spatial_dataset_version gv
        on gv.tenant_id = g.tenant_id and gv.id = g.dataset_version_id
      left join lateral (
        select sum(a.affected_area_m2) as affected_area_m2
        from app.affectation a
        join app.spatial_dataset_version av
          on av.tenant_id = a.tenant_id and av.id = a.dataset_version_id and av.is_active
        where a.tenant_id = p.tenant_id and a.parcel_id = p.id
      ) agg on true
      where p.tenant_id = ${ctx.tenantId} and p.project_id = ${projectId}
      order by p.chainage_m nulls last, p.parcel_code
      limit ${PARCEL_PAYLOAD_LIMIT + 1}
    `);

    const raw = parcelRows.rows as Array<{
      id: string;
      parcel_code: string;
      sector_label: string | null;
      side: ParcelSide;
      status: ParcelStatus;
      chainage_m: string | null;
      chainage_method: ChainageMethod | null;
      frontage_m: string | null;
      provenance_id: string;
      area_m2: string | null;
      affected_area_m2: string | null;
      geojson: string | null;
      analysis_srid: number | null;
      ref_lon: number | null;
      ref_lat: number | null;
      ref_easting: number | null;
      ref_northing: number | null;
    }>;
    const truncated = raw.length > PARCEL_PAYLOAD_LIMIT;
    const bounded = truncated ? raw.slice(0, PARCEL_PAYLOAD_LIMIT) : raw;

    const provenance = await loadProvenanceRecords(
      tx,
      ctx,
      bounded.map((r) => r.provenance_id),
    );
    const facets = (id: string) => {
      const record = provenance.get(id);
      if (!record) throw new Error("provenance record missing for a visible parcel");
      return facetsOf(record);
    };

    const parcels: ParcelRow[] = bounded.map((row) => {
      const areaM2 = toNumber(row.area_m2);
      const affected = toNumber(row.affected_area_m2);
      return {
        id: row.id,
        parcelCode: row.parcel_code,
        sectorLabel: row.sector_label,
        side: row.side,
        status: row.status,
        chainageM: toNumber(row.chainage_m),
        chainageMethod: row.chainage_method,
        frontageM: toNumber(row.frontage_m),
        areaM2,
        affectedAreaM2: affected,
        affectationRatio:
          areaM2 !== null && affected !== null ? affectationRatio(affected, areaM2) : null,
        referencePoint: referencePointOf(row),
        provenanceId: row.provenance_id,
        provenance: facets(row.provenance_id),
      };
    });

    const features: ParcelFeature[] = [];
    for (const row of bounded) {
      if (!row.geojson) continue;
      features.push({
        type: "Feature",
        id: row.id,
        geometry: JSON.parse(row.geojson) as ParcelFeature["geometry"],
        properties: { parcelId: row.id, parcelCode: row.parcel_code, status: row.status },
      });
    }

    const alignmentRow = alignmentRows.rows[0] as
      { label: string; length_m: string; provenance_id: string; geojson: string } | undefined;
    const alignmentProvenance = alignmentRow
      ? await loadProvenanceRecords(tx, ctx, [alignmentRow.provenance_id])
      : new Map();
    const alignmentGeometry = alignmentRow ? JSON.parse(alignmentRow.geojson) : null;

    /*
     * Where the map opens: the parcels and the centreline, and deliberately nothing else.
     *
     * `unionBounds` walks down to the numbers rather than indexing to a fixed depth, which is the
     * whole point — every parcel of this study is stored as a `MultiPolygon` and the centreline as
     * a `MultiLineString`, and the previous two-level loop turned all of them into `NaN`, so the
     * read model returned no extent and the map opened on `[0, 0]` at zoom 1 (docs/manual §3).
     *
     * The areas of influence are **not** in it. The indirect social area spans about 22 by 28 km
     * against the corridor's 4 by 6: framing it would make the object of the work — the road and
     * its frontage parcels — a smudge in the middle of a mostly empty rectangle. They are context,
     * and the toggle beside the legend is where a reader asks for them.
     */

    return {
      alignment: alignmentRow
        ? {
            label: alignmentRow.label,
            lengthM: Number(alignmentRow.length_m),
            geometry: alignmentGeometry,
            provenanceId: alignmentRow.provenance_id,
            provenance: facetsOf(alignmentProvenance.get(alignmentRow.provenance_id)!),
          }
        : null,
      parcels,
      features,
      influenceAreas: (
        influenceRows.rows as unknown as ReadonlyArray<{
          kind: string;
          label: string;
          area_m2: string;
          provenance_id: string;
          geojson: string;
        }>
      ).map((row) => ({
        kind: row.kind,
        label: row.label,
        areaHa: Number(row.area_m2) / 10_000,
        geometry: JSON.parse(row.geojson),
        provenanceId: row.provenance_id,
      })),
      layers,
      bounds: extendBounds(
        unionBounds(features.map((feature) => feature.geometry)),
        geometryBounds(alignmentGeometry),
      ),
      truncated,
    };
  });
}

export interface ParcelAffectation {
  readonly id: string;
  readonly category: AffectationCategory;
  readonly affectedAreaM2: number;
  readonly ratioOfParcel: number | null;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}

/**
 * What is around the parcel, so a reader can tell *where* it is and not only *what shape* it is.
 *
 * ## Why the detail map needs anything beyond the parcel
 *
 * A polygon on an empty ground tells you its shape and nothing else. The question somebody opens
 * a parcel to answer — is this the one by the river, which side of the road, who is next to it —
 * needs the surroundings. The reference background supplies the terrain; these two supply the
 * *study's own* context, which no provider has: the road this corridor is about, and the
 * neighbouring parcels of the same delivery.
 *
 * ## Clipped, not whole
 *
 * The centreline is intersected with the context box rather than sent entire. A 5,9 km road
 * delivered to a 300 m view is 99 % coordinates nobody will see, and the clip happens in PostGIS
 * where the geometry already is. It is a **segment**, and the surface says so rather than
 * implying the parcel sits at the end of a road that stops there.
 *
 * Neighbours are the same layer, the same dataset version and the same permission as the parcel
 * itself — `parcels.read` — so showing them discloses nothing the Explorer does not already show
 * the same caller. They carry a code and an outline and deliberately nothing else: no area, no
 * status, no owner. They are context, not a second table.
 */
export interface ParcelNeighbour {
  readonly parcelCode: string;
  readonly geometry: unknown;
}

export interface ParcelSurroundings {
  /**
   * What the map opens on: the parcel's extent widened so its surroundings are visible.
   *
   * Computed in the dataset's **analysis CRS**, so the margin is metres on the ground rather than
   * degrees — a degree of longitude is not a degree of latitude, and a box padded in degrees is a
   * different margin on each axis at every latitude but the equator.
   */
  readonly contextBounds: readonly [number, number, number, number];
  /** The centreline inside that box. Null when the project has none, or none reaches here. */
  readonly alignmentSegment: unknown | null;
  readonly neighbours: ReadonlyArray<ParcelNeighbour>;
  /** True when the neighbour query hit its ceiling, so the surface can say the context is partial. */
  readonly neighboursTruncated: boolean;
}

export interface ParcelWorkspaceView {
  readonly parcel: ParcelRow;
  readonly geometry: unknown | null;
  /** The parcel's own extent — what «Centrar predio» returns to. */
  readonly bounds: readonly [number, number, number, number] | null;
  /** Null exactly when `geometry` is: there is nothing to be around. */
  readonly surroundings: ParcelSurroundings | null;
  readonly affectations: ReadonlyArray<ParcelAffectation>;
  readonly datasetVersion: LayerProvenance | null;
  readonly alignmentLabel: string | null;
}

/**
 * How much ground around the parcel the map opens on.
 *
 * At least 120 m, and more for a large parcel: three quarters of its own longest side. A fixed
 * margin would bury a 20 m town plot and barely register around a 6 ha farm, and the point of the
 * margin is the same in both cases — enough neighbourhood to recognise the place.
 */
const PARCEL_CONTEXT_MIN_MARGIN_M = 120;
const PARCEL_CONTEXT_MARGIN_RATIO = 0.75;
/** Enough neighbours to read a block; far short of a second copy of the Explorer. */
const PARCEL_NEIGHBOUR_LIMIT = 60;

/**
 * The surroundings row, turned into the view's shape — or nothing.
 *
 * A clip can legitimately produce an empty geometry (`GEOMETRYCOLLECTION EMPTY` when the
 * centreline grazes the box without entering it), and an empty geometry drawn as a layer is a
 * layer with nothing in it. It is reported as **absent** instead, so the surface can say "no road
 * segment here" rather than showing an empty one.
 */
function surroundingsOf(raw: unknown): ParcelSurroundings | null {
  if (raw === undefined || raw === null) return null;
  const row = raw as {
    west: number | null;
    south: number | null;
    east: number | null;
    north: number | null;
    alignment: string | null;
    neighbours: ReadonlyArray<{ code: string; geojson: string }> | null;
  };
  const box = [row.west, row.south, row.east, row.north].map(Number);
  if (box.some((v) => !Number.isFinite(v))) return null;
  const [west, south, east, north] = box as [number, number, number, number];

  const alignment = nonEmptyGeometry(row.alignment);
  const all = (row.neighbours ?? [])
    .map((n) => ({ parcelCode: n.code, geometry: nonEmptyGeometry(n.geojson) }))
    .filter((n): n is ParcelNeighbour => n.geometry !== null);
  const truncated = all.length > PARCEL_NEIGHBOUR_LIMIT;

  return {
    contextBounds: [west, south, east, north],
    alignmentSegment: alignment,
    neighbours: truncated ? all.slice(0, PARCEL_NEIGHBOUR_LIMIT) : all,
    neighboursTruncated: truncated,
  };
}

/** Parsed GeoJSON, unless it is an empty geometry — which is not something to draw. */
function nonEmptyGeometry(geojson: string | null): unknown | null {
  if (!geojson) return null;
  const parsed = JSON.parse(geojson) as { type?: string; coordinates?: unknown; geometries?: [] };
  if (parsed.type === "GeometryCollection") {
    return (parsed.geometries ?? []).length > 0 ? parsed : null;
  }
  return collectPositions(parsed.coordinates).length > 0 ? parsed : null;
}

/** The Parcel Workspace, addressed by the business code as the design does. */
export async function loadParcelWorkspace(
  db: Database,
  ctx: RequestContext,
  parcelCode: string,
): Promise<ParcelWorkspaceView> {
  requireCapability(ctx, "gis.parcels");
  requirePermission(ctx, "parcels.read");
  if (ctx.projectId === null) throw new NotFound("parcel");
  const projectId = ctx.projectId;

  return withDbContext(db, ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select p.id,
             p.parcel_code,
             p.sector_label,
             p.side,
             p.status,
             p.chainage_m,
             p.chainage_method,
             p.frontage_m,
             p.provenance_id,
             g.area_m2,
             g.dataset_version_id,
             agg.affected_area_m2,
             ST_AsGeoJSON(g.geom, 6) as geojson,
             ST_XMin(ST_Envelope(g.geom)) as west,
             ST_YMin(ST_Envelope(g.geom)) as south,
             ST_XMax(ST_Envelope(g.geom)) as east,
             ST_YMax(ST_Envelope(g.geom)) as north,
             -- The same reference point the Explorer shows, from the same transform.
             gv.analysis_srid,
             ST_X(ST_PointOnSurface(g.geom)) as ref_lon,
             ST_Y(ST_PointOnSurface(g.geom)) as ref_lat,
             ST_X(ST_Transform(ST_PointOnSurface(g.geom), gv.analysis_srid)) as ref_easting,
             ST_Y(ST_Transform(ST_PointOnSurface(g.geom), gv.analysis_srid)) as ref_northing
      from app.parcel p
      left join app.parcel_geometry g
        on g.tenant_id = p.tenant_id and g.parcel_id = p.id and g.is_active
      left join app.spatial_dataset_version gv
        on gv.tenant_id = g.tenant_id and gv.id = g.dataset_version_id
      left join lateral (
        select sum(a.affected_area_m2) as affected_area_m2
        from app.affectation a
        join app.spatial_dataset_version av
          on av.tenant_id = a.tenant_id and av.id = a.dataset_version_id and av.is_active
        where a.tenant_id = p.tenant_id and a.parcel_id = p.id
      ) agg on true
      where p.tenant_id = ${ctx.tenantId}
        and p.project_id = ${projectId}
        and p.parcel_code = ${parcelCode}
      limit 1
    `);
    const row = rows.rows[0] as
      | {
          id: string;
          parcel_code: string;
          sector_label: string | null;
          side: ParcelSide;
          status: ParcelStatus;
          chainage_m: string | null;
          chainage_method: ChainageMethod | null;
          frontage_m: string | null;
          provenance_id: string;
          area_m2: string | null;
          dataset_version_id: string | null;
          affected_area_m2: string | null;
          geojson: string | null;
          west: number | null;
          south: number | null;
          east: number | null;
          north: number | null;
          analysis_srid: number | null;
          ref_lon: number | null;
          ref_lat: number | null;
          ref_easting: number | null;
          ref_northing: number | null;
        }
      | undefined;
    if (!row) throw new NotFound("parcel");

    /*
     * The surroundings, in one query, in the dataset's own analysis CRS.
     *
     * The box is built in metres and transformed back: `ST_Expand` on a geography in degrees would
     * pad the two axes by different distances everywhere but the equator. The centreline is
     * **clipped** to that box rather than sent whole, and the neighbours are the same layer under
     * the same policy — `app.parcel`'s RLS has already decided which rows exist for this caller,
     * so a parcel of another tenant cannot appear here however the box is drawn.
     */
    const surroundingRows = row.geojson
      ? await tx.execute(sql`
          with target as (
            select g.geom,
                   gv.analysis_srid as srid,
                   ST_Transform(g.geom, gv.analysis_srid) as metric
              from app.parcel_geometry g
              join app.spatial_dataset_version gv
                on gv.tenant_id = g.tenant_id and gv.id = g.dataset_version_id
             where g.tenant_id = ${ctx.tenantId} and g.parcel_id = ${row.id} and g.is_active
             limit 1
          ),
          box as (
            select ST_Transform(
                     ST_Envelope(
                       ST_Expand(
                         ST_Envelope(metric),
                         greatest(
                           ${sql.raw(String(PARCEL_CONTEXT_MIN_MARGIN_M))},
                           ${sql.raw(String(PARCEL_CONTEXT_MARGIN_RATIO))} * greatest(
                             ST_XMax(ST_Envelope(metric)) - ST_XMin(ST_Envelope(metric)),
                             ST_YMax(ST_Envelope(metric)) - ST_YMin(ST_Envelope(metric))
                           )
                         )
                       )
                     ),
                     ${sql.raw(String(CANONICAL_SRID))}
                   ) as g
              from target
          )
          select ST_XMin(box.g) as west,
                 ST_YMin(box.g) as south,
                 ST_XMax(box.g) as east,
                 ST_YMax(box.g) as north,
                 (
                   select ST_AsGeoJSON(ST_Intersection(al.geom, box.g), 6)
                     from app.alignment al
                     join app.spatial_dataset_version v
                       on v.tenant_id = al.tenant_id and v.id = al.dataset_version_id and v.is_active
                    where al.tenant_id = ${ctx.tenantId}
                      and al.project_id = ${projectId}
                      and ST_Intersects(al.geom, box.g)
                    limit 1
                 ) as alignment,
                 (
                   select json_agg(json_build_object('code', n.parcel_code, 'geojson', n.geojson))
                     from (
                       select p2.parcel_code,
                              ST_AsGeoJSON(ST_Intersection(g2.geom, box.g), 6) as geojson
                         from app.parcel p2
                         join app.parcel_geometry g2
                           on g2.tenant_id = p2.tenant_id and g2.parcel_id = p2.id and g2.is_active
                        where p2.tenant_id = ${ctx.tenantId}
                          and p2.project_id = ${projectId}
                          and p2.id <> ${row.id}
                          and ST_Intersects(g2.geom, box.g)
                        order by p2.parcel_code
                        limit ${PARCEL_NEIGHBOUR_LIMIT + 1}
                     ) n
                 ) as neighbours
            from box
        `)
      : null;

    const affectationRows = await tx
      .select({
        id: gisSchema.affectation.id,
        category: gisSchema.affectation.category,
        affectedAreaM2: gisSchema.affectation.affectedAreaM2,
        provenanceId: gisSchema.affectation.provenanceId,
      })
      .from(gisSchema.affectation)
      .innerJoin(
        gisSchema.spatialDatasetVersion,
        and(
          eq(gisSchema.spatialDatasetVersion.tenantId, gisSchema.affectation.tenantId),
          eq(gisSchema.spatialDatasetVersion.id, gisSchema.affectation.datasetVersionId),
          eq(gisSchema.spatialDatasetVersion.isActive, true),
        ),
      )
      .where(
        and(
          eq(gisSchema.affectation.tenantId, ctx.tenantId),
          eq(gisSchema.affectation.projectId, projectId),
          eq(gisSchema.affectation.parcelId, row.id),
        ),
      );

    const provenance = await loadProvenanceRecords(tx, ctx, [
      row.provenance_id,
      ...affectationRows.map((a) => a.provenanceId),
    ]);
    const facets = (id: string) => facetsOf(provenance.get(id)!);

    const areaM2 = toNumber(row.area_m2);
    const affected = toNumber(row.affected_area_m2);
    const layers = await loadLayers(tx, ctx, projectId);
    const alignmentRows = await tx
      .select({ label: gisSchema.alignment.label })
      .from(gisSchema.alignment)
      .where(
        and(
          eq(gisSchema.alignment.tenantId, ctx.tenantId),
          eq(gisSchema.alignment.projectId, projectId),
        ),
      )
      .limit(1);

    return {
      parcel: {
        id: row.id,
        parcelCode: row.parcel_code,
        sectorLabel: row.sector_label,
        side: row.side,
        status: row.status,
        chainageM: toNumber(row.chainage_m),
        chainageMethod: row.chainage_method,
        frontageM: toNumber(row.frontage_m),
        areaM2,
        affectedAreaM2: affected,
        affectationRatio:
          areaM2 !== null && affected !== null ? affectationRatio(affected, areaM2) : null,
        referencePoint: referencePointOf(row),
        provenanceId: row.provenance_id,
        provenance: facets(row.provenance_id),
      },
      geometry: row.geojson ? JSON.parse(row.geojson) : null,
      bounds:
        row.west !== null && row.south !== null && row.east !== null && row.north !== null
          ? [row.west, row.south, row.east, row.north]
          : null,
      surroundings: surroundingsOf(surroundingRows?.rows[0]),
      affectations: affectationRows.map((a) => ({
        id: a.id,
        category: a.category,
        affectedAreaM2: Number(a.affectedAreaM2),
        // No active geometry means no parcel area to divide by, so there is no share to state.
        ratioOfParcel: areaM2 === null ? null : affectationRatio(Number(a.affectedAreaM2), areaM2),
        provenanceId: a.provenanceId,
        provenance: facets(a.provenanceId),
      })),
      datasetVersion: layers.find((l) => l.datasetKind === "parcels") ?? null,
      alignmentLabel: alignmentRows[0]?.label ?? null,
    };
  });
}

export interface TerritorialSummary {
  readonly parcelCount: number;
  readonly byStatus: Readonly<Record<ParcelStatus, number>>;
  readonly totalAreaM2: number;
  readonly affectedAreaM2: number;
  readonly withGeometry: number;
  readonly withoutGeometry: number;
  readonly alignmentLengthM: number | null;
  readonly alignmentLabel: string | null;
  readonly layers: ReadonlyArray<LayerProvenance>;
}

/**
 * The Command Center's territorial summary (TD-023, GIS portion).
 *
 * Every figure is counted or measured from the active layers at read time, so the panel cannot
 * disagree with the map, and it inherits the layers' provenance rather than claiming one of its
 * own: a synthetic corridor summarised is still synthetic. `withoutGeometry` is what feeds the
 * `partial GIS` state — a project halfway through an import must say so, not round up.
 *
 * Returns `null` when the project has no parcels at all; the surface then renders `no GIS yet`
 * instead of a row of zeroes that reads like a finding.
 */
export async function loadTerritorialSummary(
  db: Database,
  ctx: RequestContext,
): Promise<TerritorialSummary | null> {
  requireCapability(ctx, "gis.parcels");
  requirePermission(ctx, "parcels.read");
  if (ctx.projectId === null) throw new Error("loadTerritorialSummary requires a project context");
  const projectId = ctx.projectId;

  return withDbContext(db, ctx, async (tx) => {
    const rows = await tx.execute(sql`
      select p.status,
             count(*)::int as parcels,
             count(g.id)::int as with_geometry,
             coalesce(sum(g.area_m2), 0)::float8 as area_m2,
             coalesce(sum(agg.affected_area_m2), 0)::float8 as affected_m2
      from app.parcel p
      left join app.parcel_geometry g
        on g.tenant_id = p.tenant_id and g.parcel_id = p.id and g.is_active
      left join lateral (
        select sum(a.affected_area_m2) as affected_area_m2
        from app.affectation a
        join app.spatial_dataset_version av
          on av.tenant_id = a.tenant_id and av.id = a.dataset_version_id and av.is_active
        where a.tenant_id = p.tenant_id and a.parcel_id = p.id
      ) agg on true
      where p.tenant_id = ${ctx.tenantId} and p.project_id = ${projectId}
      group by p.status
    `);
    if (rows.rows.length === 0) return null;

    const byStatus: Record<ParcelStatus, number> = {
      confirmed: 0,
      estimated: 0,
      not_located: 0,
      excluded: 0,
    };
    let parcelCount = 0;
    let withGeometry = 0;
    let totalAreaM2 = 0;
    let affectedAreaM2 = 0;
    for (const raw of rows.rows as unknown as ReadonlyArray<{
      status: ParcelStatus;
      parcels: number;
      with_geometry: number;
      area_m2: number;
      affected_m2: number;
    }>) {
      byStatus[raw.status] = raw.parcels;
      parcelCount += raw.parcels;
      withGeometry += raw.with_geometry;
      totalAreaM2 += raw.area_m2;
      affectedAreaM2 += raw.affected_m2;
    }

    const alignmentRows = await tx.execute(sql`
      select a.label, a.length_m::float8 as length_m
      from app.alignment a
      join app.spatial_dataset_version v
        on v.tenant_id = a.tenant_id and v.id = a.dataset_version_id and v.is_active
      where a.tenant_id = ${ctx.tenantId} and a.project_id = ${projectId}
      limit 1
    `);
    const alignment = alignmentRows.rows[0] as { label: string; length_m: number } | undefined;

    return {
      parcelCount,
      byStatus,
      totalAreaM2,
      affectedAreaM2,
      withGeometry,
      withoutGeometry: parcelCount - withGeometry,
      alignmentLengthM: alignment?.length_m ?? null,
      alignmentLabel: alignment?.label ?? null,
      layers: await loadLayers(tx, ctx, projectId),
    };
  });
}
