import { gisSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  affectationRatio,
  deriveLayerLegend,
  NotFound,
  PRESENTATION_SRID,
  requireCapability,
  requirePermission,
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
  readonly sourceCrs: string;
  readonly generatorVersion: string | null;
  readonly featureCount: number;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
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
  readonly layers: ReadonlyArray<LayerProvenance>;
  /** Bounding box of the active parcel layer in presentation CRS: [w, s, e, n]. */
  readonly bounds: readonly [number, number, number, number] | null;
  readonly truncated: boolean;
}

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
      sourceCrs: gisSchema.spatialDatasetVersion.sourceCrs,
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
      sourceCrs: row.sourceCrs,
      generatorVersion: row.generatorVersion,
      featureCount: row.featureCount,
      provenanceId: row.provenanceId,
      provenance: facets,
    };
  });
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
             ST_AsGeoJSON(ST_Transform(a.geom, ${sql.raw(String(PRESENTATION_SRID))}), 6) as geojson
      from app.alignment a
      join app.spatial_dataset_version v
        on v.tenant_id = a.tenant_id and v.id = a.dataset_version_id and v.is_active
      where a.tenant_id = ${ctx.tenantId} and a.project_id = ${projectId}
      limit 1
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
             ST_AsGeoJSON(ST_Transform(g.geom, ${sql.raw(String(PRESENTATION_SRID))}), 6) as geojson
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
        provenanceId: row.provenance_id,
        provenance: facets(row.provenance_id),
      };
    });

    const features: ParcelFeature[] = [];
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const row of bounded) {
      if (!row.geojson) continue;
      const geometry = JSON.parse(row.geojson) as { coordinates: number[][][] };
      for (const ring of geometry.coordinates) {
        for (const [x, y] of ring) {
          if (x === undefined || y === undefined) continue;
          west = Math.min(west, x);
          east = Math.max(east, x);
          south = Math.min(south, y);
          north = Math.max(north, y);
        }
      }
      features.push({
        type: "Feature",
        id: row.id,
        geometry,
        properties: { parcelId: row.id, parcelCode: row.parcel_code, status: row.status },
      });
    }

    const alignmentRow = alignmentRows.rows[0] as
      { label: string; length_m: string; provenance_id: string; geojson: string } | undefined;
    const alignmentProvenance = alignmentRow
      ? await loadProvenanceRecords(tx, ctx, [alignmentRow.provenance_id])
      : new Map();

    return {
      alignment: alignmentRow
        ? {
            label: alignmentRow.label,
            lengthM: Number(alignmentRow.length_m),
            geometry: JSON.parse(alignmentRow.geojson),
            provenanceId: alignmentRow.provenance_id,
            provenance: facetsOf(alignmentProvenance.get(alignmentRow.provenance_id)!),
          }
        : null,
      parcels,
      features,
      layers,
      bounds: Number.isFinite(west) ? [west, south, east, north] : null,
      truncated,
    };
  });
}

export interface ParcelAffectation {
  readonly id: string;
  readonly category: AffectationCategory;
  readonly affectedAreaM2: number;
  readonly ratioOfParcel: number;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}

export interface ParcelWorkspaceView {
  readonly parcel: ParcelRow;
  readonly geometry: unknown | null;
  readonly bounds: readonly [number, number, number, number] | null;
  readonly affectations: ReadonlyArray<ParcelAffectation>;
  readonly datasetVersion: LayerProvenance | null;
  readonly alignmentLabel: string | null;
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
             ST_AsGeoJSON(ST_Transform(g.geom, ${sql.raw(String(PRESENTATION_SRID))}), 6) as geojson,
             ST_XMin(ST_Envelope(ST_Transform(g.geom, ${sql.raw(String(PRESENTATION_SRID))}))) as west,
             ST_YMin(ST_Envelope(ST_Transform(g.geom, ${sql.raw(String(PRESENTATION_SRID))}))) as south,
             ST_XMax(ST_Envelope(ST_Transform(g.geom, ${sql.raw(String(PRESENTATION_SRID))}))) as east,
             ST_YMax(ST_Envelope(ST_Transform(g.geom, ${sql.raw(String(PRESENTATION_SRID))}))) as north
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
        }
      | undefined;
    if (!row) throw new NotFound("parcel");

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
        provenanceId: row.provenance_id,
        provenance: facets(row.provenance_id),
      },
      geometry: row.geojson ? JSON.parse(row.geojson) : null,
      bounds:
        row.west !== null && row.south !== null && row.east !== null && row.north !== null
          ? [row.west, row.south, row.east, row.north]
          : null,
      affectations: affectationRows.map((a) => ({
        id: a.id,
        category: a.category,
        affectedAreaM2: Number(a.affectedAreaM2),
        ratioOfParcel: areaM2 ? affectationRatio(Number(a.affectedAreaM2), areaM2) : 0,
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
