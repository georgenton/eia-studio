"use client";

import type {
  ParcelExplorerView,
  ParcelFieldProgressView,
  ParcelReferencePoint,
} from "@eia/application";
import {
  CANONICAL_SRID,
  parcelFieldStateOf,
  formatChainage,
  orderLayersForLegend,
  PARCEL_STATUS_PRESENTATION,
  type BasemapCatalogue,
  type ParcelFieldState,
  type ParcelStatus,
} from "@eia/domain";
import { Chip, Panel, PanelBody, PanelHeader, ProvenanceBadge } from "@eia/ui";
import { useMemo, useState } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { ButtonLink, ProvenanceLink } from "@/components/navigation";
import {
  layerLegendLabel,
  layerLegendNote,
  parcelSideLabel,
  parcelStatusLabel,
} from "@/lib/labels";

import styles from "./parcel-explorer.module.css";
import { crsLine, formatDegrees, formatMetres } from "./crs-line";
import { ParcelMap } from "./parcel-map";
import { ParcelTable } from "./parcel-table";
import { useParcelSelection } from "./selection";

/**
 * GIS / Parcel Explorer (design v0.2 §3): filter bar, map and table sharing one selection, and a
 * contextual panel for the selected parcel.
 *
 * The map and the table are two views of one payload and one `selectedParcelId`, so they cannot
 * drift apart; the table is also the accessible representation of the map.
 */
const ALL_STATUSES = Object.keys(PARCEL_STATUS_PRESENTATION) as ParcelStatus[];

export function ParcelExplorer({
  view,
  basePath,
  parcelsPath,
  basemap,
  fieldProgress,
}: {
  view: ParcelExplorerView;
  basePath: string;
  /**
   * How the field work stands per parcel, or why it cannot be shown.
   *
   * Never a map of zeros: a caller without `field.read` gets `available: false`, and the surface
   * offers the colouring with the reason rather than painting every parcel *sin asignar*.
   */
  fieldProgress: ParcelFieldProgressView;
  /** What may be drawn under the study's layers here, if anything (`docs/BASEMAP_POLICY.md`). */
  basemap: BasemapCatalogue;
  /** Prefix of the Parcel Workspace route; a plain string because functions cannot cross the
   * server/client boundary. */
  parcelsPath: string;
}) {
  const { t, fmt } = useI18n();
  const workspacePath = (parcelCode: string) => `${parcelsPath}/${encodeURIComponent(parcelCode)}`;
  const selection = useParcelSelection(null);
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<ReadonlySet<ParcelStatus>>(new Set());
  const [visibleCount, setVisibleCount] = useState(view.parcels.length);

  const sectors = useMemo(
    () => [...new Set(view.parcels.map((p) => p.sectorLabel).filter((s): s is string => !!s))],
    [view.parcels],
  );
  // One row per distinct legend, in a fixed reading order. Two dataset versions can share a
  // legend (parcels and affectations are both synthetic polygons), and the order must not depend
  // on the order the database happened to return (IG2-007).
  const legendRows = useMemo(
    () => [...new Map(orderLayersForLegend(view.layers).map((l) => [l.legend, l])).values()],
    [view.layers],
  );
  const [showInfluenceAreas, setShowInfluenceAreas] = useState(true);
  const [showAlignment, setShowAlignment] = useState(true);
  const [showParcels, setShowParcels] = useState(true);
  /*
   * Where the camera is. It starts null rather than at the project's centre, because until the map
   * has reported a frame nobody knows where it is looking, and printing the extent's midpoint as
   * "centre of the view" would be a coordinate the reader is not actually being shown.
   */
  const [centre, setCentre] = useState<{ lon: number; lat: number } | null>(null);
  /*
   * What the parcel colours mean. Two colourings, never merged: `cartographic` is whether the
   * geometry is trusted, `field` is whether anybody has been there. They are different facts
   * about the same object, and one palette meaning both would make them indistinguishable.
   */
  const [colourBy, setColourBy] = useState<"cartographic" | "field">("cartographic");
  const fieldStates = useMemo(() => {
    if (!fieldProgress.available) return null;
    const byId = new Map<string, ParcelFieldState>();
    for (const parcel of view.parcels) {
      byId.set(parcel.id, parcelFieldStateOf(fieldProgress.byParcelId.get(parcel.id)));
    }
    return byId;
  }, [fieldProgress, view.parcels]);
  const selected = view.parcels.find((p) => p.id === selection.selectedParcelId) ?? null;
  /*
   * Which CRS the metric figures were computed in: the **parcels** dataset's own, because that is
   * the layer whose areas, frontages and reference points this surface prints. Two datasets may
   * legitimately declare different analysis CRS, so the one shown names its layer rather than
   * standing for the project.
   */
  const metricSrid =
    view.layers.find((l) => l.datasetKind === "parcels")?.analysisSrid ??
    view.layers[0]?.analysisSrid ??
    null;
  const presentStatuses = ALL_STATUSES.filter((s) => view.parcels.some((p) => p.status === s));

  const toggleStatus = (status: ParcelStatus) =>
    setStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });

  return (
    <div className={styles.surface}>
      <div className={styles.filters} role="search">
        <label className={styles.searchLabel} htmlFor="parcel-search">
          {t("gis.searchParcel")}
        </label>
        <input
          className={styles.search}
          id="parcel-search"
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("gis.searchPlaceholder")}
          type="search"
          value={search}
        />
        <label className={styles.selectLabel} htmlFor="parcel-sector">
          {t("gis.sector")}
        </label>
        <select
          className={styles.select}
          id="parcel-sector"
          onChange={(event) => setSector(event.target.value || null)}
          value={sector ?? ""}
        >
          <option value="">{t("common.all")}</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <fieldset className={styles.statusGroup}>
          <legend className={styles.selectLabel}>{t("common.status")}</legend>
          {presentStatuses.map((status) => (
            <label className={styles.statusOption} key={status}>
              <input
                checked={statuses.has(status)}
                onChange={() => toggleStatus(status)}
                type="checkbox"
              />
              <span aria-hidden="true">{PARCEL_STATUS_PRESENTATION[status].glyph}</span>
              {parcelStatusLabel(t, status)}
            </label>
          ))}
        </fieldset>
        <p className={styles.count}>
          {t("gis.parcelCount", {
            total: fmt.count(view.parcels.length),
            visible: fmt.count(visibleCount),
          })}
        </p>
      </div>

      <div className={styles.split}>
        <div className={styles.mapArea}>
          <ParcelMap
            basemap={basemap}
            colourBy={colourBy}
            fieldStates={fieldStates}
            onCentreChange={setCentre}
            onSelect={selection.select}
            selectedParcelId={selection.selectedParcelId}
            showAlignment={showAlignment}
            showInfluenceAreas={showInfluenceAreas}
            showParcels={showParcels}
            view={view}
          />
          <div className={styles.layerLegend}>
            <div className={styles.layerTitle}>{t("gis.layerProvenance")}</div>
            <ul className={styles.layerList}>
              {/* Two dataset versions can share a legend (parcels and affectations are both
                  synthetic polygons); the legend describes the *layers on the map*, so it is
                  keyed by legend and shown once. */}
              {legendRows.map((layer) => (
                <li className={styles.layerRow} key={layer.legend}>
                  <span className={styles.layerKey}>{layerLegendLabel(t, layer.legend)}</span>
                  <span className={styles.layerNote}>{layerLegendNote(t, layer.legend)}</span>
                  <ProvenanceLink href={`${basePath}?prov=${layer.provenanceId}`} />
                </li>
              ))}
            </ul>

            {/*
              The areas the study delimited, and a switch for them. They are drawn as a generalised
              outline — enough to read a corridor against, not a substitute for the stored polygon —
              and the note says so rather than implying the map is the survey.
            */}
            {view.influenceAreas.length > 0 ? (
              <div className={styles.influenceBlock}>
                {/* The switch moved up into the layer panel, where every layer's is. What stays
                    here is what the switch is *for*: which areas the study delimited and how big
                    each one is. */}
                <div className={styles.layerTitle}>{t("gis.influenceAreas")}</div>
                <ul className={styles.influenceList}>
                  {view.influenceAreas.map((area) => (
                    <li key={area.kind}>
                      <span>{area.label}</span>
                      <span className={styles.influenceArea}>{fmt.decimal(area.areaHa, 0)} ha</span>
                    </li>
                  ))}
                </ul>
                <p className={styles.influenceNote}>{t("gis.influenceNote")}</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className={styles.mapTools}>
          <div className={styles.toolCard}>
            {/*
                What is drawn, and the switch for each.
                A switch here changes only what MapLibre paints: the payload is unchanged, the table
                keeps every row, and the selection keeps working — which is why the note says so
                rather than leaving a reader to wonder whether hiding a layer dropped data.
              */}
            <div className={styles.layerTitle}>{t("gis.colourBy")}</div>
            <div className={styles.colourSwitch}>
              <label className={styles.drawToggle}>
                <input
                  checked={colourBy === "cartographic"}
                  data-testid="colour-by-cartographic"
                  name="colour-by"
                  onChange={() => setColourBy("cartographic")}
                  type="radio"
                />
                {t("gis.colourByCartographic")}
              </label>
              <label className={styles.drawToggle}>
                <input
                  checked={colourBy === "field"}
                  data-testid="colour-by-field"
                  disabled={fieldStates === null}
                  name="colour-by"
                  onChange={() => setColourBy("field")}
                  type="radio"
                />
                {t("gis.colourByField")}
              </label>
            </div>
            {/*
              A refusal, never a map of zeros. Painting every parcel "sin asignar" for somebody
              who may not read the campaign would be a false statement in colour, and nobody
              doubts a colour.
            */}
            {fieldProgress.available ? null : (
              <p className={styles.layerHint} data-testid="field-colour-unavailable">
                {t(
                  fieldProgress.reason === "permission"
                    ? "gis.colourByFieldDenied"
                    : "gis.colourByFieldNoProject",
                )}
              </p>
            )}
            <div className={styles.layerTitle}>{t("gis.layers")}</div>
            <ul className={styles.drawList}>
              <li className={styles.drawRow}>
                <label className={styles.drawToggle}>
                  <input
                    checked={showParcels}
                    data-testid="layer-toggle-parcels"
                    onChange={(event) => setShowParcels(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  {t("gis.layerParcels")}
                </label>
                <span className={styles.drawCount}>{fmt.count(view.parcels.length)}</span>
              </li>
              <li className={styles.drawRow}>
                <label className={styles.drawToggle}>
                  <input
                    checked={showAlignment && view.alignment !== null}
                    data-testid="layer-toggle-alignment"
                    disabled={view.alignment === null}
                    onChange={(event) => setShowAlignment(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  {t("gis.layerAlignment")}
                </label>
                {view.alignment === null ? (
                  <span className={styles.drawCount}>{t("common.missing")}</span>
                ) : null}
              </li>
              <li className={styles.drawRow}>
                <label className={styles.drawToggle}>
                  <input
                    checked={showInfluenceAreas && view.influenceAreas.length > 0}
                    data-testid="layer-toggle-influence"
                    disabled={view.influenceAreas.length === 0}
                    onChange={(event) => setShowInfluenceAreas(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  {t("gis.layerInfluence")}
                </label>
                {view.influenceAreas.length === 0 ? (
                  <span className={styles.drawCount}>{t("common.missing")}</span>
                ) : null}
              </li>
            </ul>
            <p className={styles.layerHint}>{t("gis.layersNote")}</p>
            <p className={styles.layerHint}>{t("gis.northNote")}</p>
            <p className={styles.layerHint}>{t("gis.tooltipHint")}</p>
          </div>
          <CoordinatesPanel
            centre={centre}
            metricSrid={metricSrid}
            selected={
              selected ? { code: selected.parcelCode, point: selected.referencePoint } : null
            }
          />
        </div>

        <aside className={styles.panel}>
          {selected ? (
            <Panel>
              <PanelHeader
                label={t("gis.selectedParcel")}
                badge={<ProvenanceBadge facets={selected.provenance} t={t} />}
              />
              <PanelBody>
                <h2 className={styles.parcelCode}>{selected.parcelCode}</h2>
                <p className={styles.parcelMeta}>
                  {selected.sectorLabel ?? t("gis.noSector")}
                  {selected.chainageM === null
                    ? null
                    : ` · ${t("gis.chainageAbbrev")} ${formatChainage(selected.chainageM)}`}
                  {` · ${t("gis.sideLine", {
                    side: parcelSideLabel(t, selected.side).toLowerCase(),
                  })}`}
                </p>
                <div className={styles.chipRow}>
                  <Chip tone={selected.status === "confirmed" ? "ok" : "neutral"}>
                    <span aria-hidden="true">
                      {PARCEL_STATUS_PRESENTATION[selected.status].glyph}
                    </span>
                    {parcelStatusLabel(t, selected.status)}
                  </Chip>
                </div>
                <dl className={styles.facts}>
                  <div>
                    <dt>{t("gis.totalArea")}</dt>
                    <dd>
                      {selected.areaM2 === null
                        ? t("common.missing")
                        : `${fmt.decimal(selected.areaM2 / 10_000, 2)} ha`}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("gis.frontage")}</dt>
                    <dd>
                      {selected.frontageM === null
                        ? t("common.missing")
                        : `${fmt.decimal(selected.frontageM)} m`}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("gis.estimatedAffectation")}</dt>
                    <dd>
                      {selected.affectationRatio === null || selected.affectedAreaM2 === null
                        ? t("common.missing")
                        : `${fmt.decimal(selected.affectedAreaM2 / 10_000, 2)} ha · ${fmt.percent(selected.affectationRatio)}`}
                    </dd>
                  </div>
                </dl>
                <div className={styles.panelActions}>
                  <ButtonLink href={workspacePath(selected.parcelCode)} variant="primary">
                    {t("gis.openWorkspace")}
                  </ButtonLink>
                  <ProvenanceLink href={`${basePath}?prov=${selected.provenanceId}`}>
                    {t("gis.viewProvenance")}
                  </ProvenanceLink>
                </div>
              </PanelBody>
            </Panel>
          ) : (
            <Panel>
              <PanelHeader label={t("gis.selectedParcel")} />
              <PanelBody>
                <p className={styles.muted}>{t("gis.selectPrompt")}</p>
              </PanelBody>
            </Panel>
          )}
        </aside>
      </div>

      <div className={styles.tableArea}>
        <ParcelTable
          filters={{ search, sector, statuses }}
          onSelect={selection.select}
          onVisibleCountChange={setVisibleCount}
          parcels={view.parcels}
          selectedParcelId={selection.selectedParcelId}
          workspaceHref={workspacePath}
        />
      </div>
    </div>
  );
}

/**
 * Where the map is looking, and where the selected parcel is — in both coordinate systems, each
 * named.
 *
 * ## Why it is in the document and not on the canvas
 *
 * Every other map puts a coordinate readout in a corner of the drawing, where it follows the
 * cursor. That readout is unreachable here for the same reason the navigation control is (§26,
 * IG2-005): the canvas is `aria-hidden`, so text inside it is text nobody using a screen reader
 * will ever be read. This is ordinary document text, it updates when the camera settles, and the
 * parcel half changes with the one canonical selection the table and the map share.
 *
 * ## Why two coordinate systems and not one
 *
 * They answer different questions. The geographic pair is what a phone's GPS and this product's
 * own storage speak; the projected pair is what the study's drawings, a field GPS and a total
 * station speak, and it is the one a cartographer can check against the delivered cartography in
 * a second. Showing only one would make a reader convert, and a conversion done by hand beside a
 * map is a conversion that can be wrong.
 *
 * The projected pair comes from PostGIS, in the dataset version's own analysis CRS. The browser
 * reprojects nothing.
 */
function CoordinatesPanel({
  centre,
  metricSrid,
  selected,
}: {
  centre: { lon: number; lat: number } | null;
  metricSrid: number | null;
  selected: { code: string; point: ParcelReferencePoint | null } | null;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.coords} data-testid="map-coordinates">
      <div className={styles.layerTitle}>{t("gis.coordinates")}</div>
      <dl className={styles.coordsCrs}>
        <div>
          <dt>{t("gis.crsShown")}</dt>
          <dd className={styles.mono}>{crsLine(CANONICAL_SRID, t)}</dd>
        </div>
        {metricSrid === null ? null : (
          <div>
            <dt>{t("gis.crsMeasured")}</dt>
            <dd className={styles.mono}>{crsLine(metricSrid, t)}</dd>
          </div>
        )}
      </dl>
      <p className={styles.coordsNote}>{t("gis.crsNote")}</p>

      {centre === null ? null : (
        <div className={styles.coordsBlock}>
          <div className={styles.coordsLabel}>{t("gis.coordinatesCentre")}</div>
          <p className={styles.mono} data-testid="map-centre">
            {formatDegrees(centre.lat)} · {formatDegrees(centre.lon)}
          </p>
        </div>
      )}

      {selected === null ? null : (
        <div className={styles.coordsBlock}>
          <div className={styles.coordsLabel}>
            {t("gis.coordinatesParcel", { code: selected.code })}
          </div>
          {selected.point === null ? (
            <p className={styles.coordsNote}>{t("gis.coordinatesNone")}</p>
          ) : (
            <>
              <p className={styles.mono} data-testid="parcel-coordinates-geographic">
                <span className={styles.coordsKind}>{t("gis.coordinatesGeographic")}</span>{" "}
                {formatDegrees(selected.point.lat)} · {formatDegrees(selected.point.lon)}
              </p>
              <p className={styles.mono} data-testid="parcel-coordinates-projected">
                <span className={styles.coordsKind}>{t("gis.coordinatesProjected")}</span> E{" "}
                {formatMetres(selected.point.easting)} · N {formatMetres(selected.point.northing)}
              </p>
              <p className={styles.coordsNote}>{t("gis.referencePointNote")}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
