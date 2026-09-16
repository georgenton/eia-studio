"use client";

import type { ParcelExplorerView } from "@eia/application";
import {
  formatChainage,
  orderLayersForLegend,
  PARCEL_STATUS_PRESENTATION,
  type BasemapCatalogue,
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
}: {
  view: ParcelExplorerView;
  basePath: string;
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
  const selected = view.parcels.find((p) => p.id === selection.selectedParcelId) ?? null;
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
            onSelect={selection.select}
            selectedParcelId={selection.selectedParcelId}
            showInfluenceAreas={showInfluenceAreas}
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
                <label className={styles.influenceToggle}>
                  <input
                    checked={showInfluenceAreas}
                    onChange={(event) => setShowInfluenceAreas(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  {t("gis.influenceAreas")}
                </label>
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
