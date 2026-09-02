import { type Database, type DbTx } from "@eia/db";
import { InvalidInput, sridSchema } from "@eia/domain";
import { sql } from "drizzle-orm";

/**
 * The one place that decides whether a coordinate system may be used for analysis (IG2-009).
 *
 * ## Why this is a database query and not a rule in the domain
 *
 * The answer lives in `spatial_ref_sys`. Whether a CRS is projected, what its linear unit is, and
 * whether PROJ can build a transform for it are properties of the CRS **definition** — facts the
 * database already holds and that no numeric rule can stand in for. An earlier version tried:
 * it rejected the 4xxx block as geographic, which refuses `EPSG:4087` (projected, metres) and
 * accepts `EPSG:6318` (geographic, degrees), so every area computed under it would have been
 * square degrees.
 *
 * Four conditions, all read from the catalogue:
 *
 * 1. the SRID is registered in `spatial_ref_sys` — no authority is assumed, so a custom SRS an
 *    operator registered counts;
 * 2. its definition is a projected CRS (`PROJCS` in WKT1, `PROJCRS` in WKT2);
 * 3. its linear unit is the metre, because the stored columns are metres and square metres;
 * 4. `ST_Transform` can actually use it — a definition can be well formed and still unusable.
 *
 * The `spatial_dataset_version_crs_valid` trigger enforces the same predicates underneath. This
 * function exists so a caller gets a sentence explaining what is wrong instead of a PostGIS
 * exception, and so the check can run before a long import starts rather than at its last insert.
 */
export class AnalysisCrsUnusable extends InvalidInput {
  constructor(
    readonly srid: number,
    reason: string,
  ) {
    super(`analysis CRS EPSG:${srid} cannot be used: ${reason}`);
    this.name = "AnalysisCrsUnusable";
  }
}

export interface AnalysisCrsCheck {
  readonly srid: number;
  readonly registered: boolean;
  readonly metricProjected: boolean;
  /** Name from the catalogue, for the error message; null when the SRID is unknown. */
  readonly label: string | null;
}

/** Ask the catalogue about a candidate CRS, without deciding anything. */
export async function inspectAnalysisSrid(
  db: Database | DbTx,
  srid: number,
): Promise<AnalysisCrsCheck> {
  // The casts are explicit because a bound parameter arrives untyped and PostgreSQL then cannot
  // resolve the function; the value itself stays a parameter.
  const rows = await db.execute(sql`
    select app.srid_is_registered(${srid}::integer) as registered,
           app.srid_is_metric_projected(${srid}::integer) as metric_projected,
           (select substring(s.srtext from '"([^"]+)"') from public.spatial_ref_sys s
             where s.srid = ${srid}::integer) as label
  `);
  const row = rows.rows[0] as unknown as {
    registered: boolean;
    metric_projected: boolean;
    label: string | null;
  };
  return {
    srid,
    registered: row.registered,
    metricProjected: row.metric_projected,
    label: row.label,
  };
}

/**
 * Throw unless `srid` may be used to measure metres. Call it before writing a dataset version, or
 * before starting an import that will.
 */
export async function assertAnalysisSridUsable(
  db: Database | DbTx,
  candidate: number,
): Promise<number> {
  const parsed = sridSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AnalysisCrsUnusable(candidate, "an SRID must be a positive integer");
  }
  const check = await inspectAnalysisSrid(db, parsed.data);
  if (!check.registered) {
    throw new AnalysisCrsUnusable(
      parsed.data,
      "it is not registered in spatial_ref_sys, so PostGIS has no definition for it",
    );
  }
  if (!check.metricProjected) {
    throw new AnalysisCrsUnusable(
      parsed.data,
      `"${check.label ?? "unknown"}" is not a projected, metre-based CRS usable by ST_Transform. ` +
        "Lengths and areas are stored in metres and square metres, so a geographic CRS would " +
        "make them degrees and a CRS in feet would make them feet",
    );
  }
  return parsed.data;
}

/**
 * Whether a source CRS may be recorded. A source CRS describes where the data *came from*, so it
 * carries no projection or unit requirement — an official package delivered in a geographic CRS is
 * perfectly normal. It must simply be something PostGIS knows, or the transform to canonical
 * storage cannot be performed or explained afterwards.
 */
export async function assertSourceSridUsable(
  db: Database | DbTx,
  candidate: number,
): Promise<number> {
  const parsed = sridSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AnalysisCrsUnusable(candidate, "an SRID must be a positive integer");
  }
  const check = await inspectAnalysisSrid(db, parsed.data);
  if (!check.registered) {
    throw new AnalysisCrsUnusable(
      parsed.data,
      "it is not registered in spatial_ref_sys, so PostGIS has no definition for it",
    );
  }
  return parsed.data;
}
