import { CANONICAL_SRID, describeEpsg } from "@eia/domain";
import type { Translator } from "@eia/i18n";

/**
 * The one line that names a coordinate system, assembled from what the code actually implies.
 *
 * Shared by the Explorer and the parcel detail, because a reader who reads
 * *EPSG:32717 · WGS 84 · UTM zona 17 S* on one surface and something else on the other would be
 * right to wonder which is true.
 *
 * `describeEpsg` says what the EPSG number guarantees and nothing else, so a code outside the two
 * WGS 84 UTM blocks prints as the bare code with an explicit *no description derivable* — never a
 * plausible zone. Every surface that shows this must also say that the description is **derived
 * from the code** rather than read from a registry, because PostGIS's `spatial_ref_sys` is the
 * authority and this has not consulted it.
 */
export function crsLine(srid: number, t: Translator): string {
  const described = describeEpsg(srid);
  const parts: string[] = [described.code];
  if (described.datum) parts.push(described.datum);
  if (described.utm) {
    parts.push(
      t("gis.crsUtm", {
        zone: String(described.utm.zone),
        hemisphere: described.utm.hemisphere,
      }),
    );
  } else if (srid === CANONICAL_SRID) {
    parts.push(t("gis.crsGeographic"));
  } else if (!described.datum) {
    parts.push(t("gis.crsUnknownName"));
  }
  return parts.join(" · ");
}

/** Six decimals of a degree is about 0,1 m here — finer than the cartography it is read off. */
export function formatDegrees(value: number): string {
  return value.toFixed(6).replace(".", ",");
}

/** A metre, in a projected CRS whose unit is the metre. A computed point has no millimetres. */
export function formatMetres(value: number): string {
  return value.toFixed(0).replace(".", ",");
}
