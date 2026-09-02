/**
 * Coordinate reference systems (ADR-003 territorial extension, docs/ARCHITECTURE.md §7).
 *
 * Two CRS, deliberately separated:
 *
 * - **Storage** `EPSG:32717` (WGS 84 / UTM zone 17S), a projected system in metres. Areas,
 *   lengths and the chainage projection are computed here, because doing metric work in degrees
 *   is wrong. The zone is a per-project choice; it is not a constant of the product.
 * - **Presentation** `EPSG:4326`, produced by `ST_Transform` at read time for MapLibre, which
 *   consumes lon/lat GeoJSON.
 *
 * ## This is a demo assumption, not the official CRS
 *
 * The official GIS package has not been delivered, so the project's real CRS is unknown. UTM 17S
 * is a defensible choice for the pilot's region and is recorded as a **RECONSTRUCTED / DEMO GIS
 * assumption**: every synthetic dataset version states it in `sourceCrs`, and an official import
 * declares its own CRS and supersedes ours. Nothing here claims to be authoritative.
 */
export const STORAGE_SRID = 32717;
export const PRESENTATION_SRID = 4326;

export const STORAGE_CRS_LABEL = "EPSG:32717 · WGS 84 / UTM zone 17S";
export const PRESENTATION_CRS_LABEL = "EPSG:4326 · WGS 84";

/** Marks a dataset whose CRS we chose for the demonstration rather than received from a source. */
export const DEMO_CRS_ASSUMPTION =
  "Supuesto de demostración: el paquete GIS oficial aún no se ha recibido, por lo que el CRS del " +
  "proyecto se desconoce. La geometría sintética se almacena en EPSG:32717 (UTM 17S) por ser " +
  "apropiado para la región; una importación oficial declarará su propio CRS y reemplazará esta.";
