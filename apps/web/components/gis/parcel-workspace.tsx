import type { ParcelVisitEntry, ParcelWorkspaceView } from "@eia/application";
import { formatChainage, PARCEL_STATUS_PRESENTATION } from "@eia/domain";
import type { MessageKey } from "@eia/i18n";
import { Chip, Panel, PanelBody, PanelHeader, ProvenanceBadge, SystemState } from "@eia/ui";

import { ButtonLink, ProvenanceLink } from "@/components/navigation";
import {
  affectationCategoryLabel,
  chainageMethodLabel,
  instanceStatusLabel,
  layerLegendLabel,
  locationOutcomeLabel,
  parcelSideLabel,
  parcelStatusLabel,
  visitStatusLabel,
} from "@/lib/labels";
import type { I18n } from "@/lib/locale";

import { ParcelGeometryMap } from "./parcel-geometry-map";
import styles from "./parcel-workspace.module.css";

/**
 * Parcel Workspace tabs (invariant 7: the parcel is the master territorial workspace). Only the
 * tabs whose modules exist are rendered as surfaces; the rest declare plainly that the module has
 * no data yet rather than showing an invented one.
 */
export const PARCEL_TABS = [
  // The key is the URL segment, in Spanish because it is part of an address people bookmark and a
  // route is not copy; the label beside it is the catalogue key that gives it words.
  { key: "resumen", label: "parcel.tabSummary" },
  { key: "afectaciones", label: "parcel.tabAffectations" },
  { key: "visitas", label: "parcel.tabVisits" },
  { key: "instrumentos", label: "parcel.tabInstruments" },
  { key: "media", label: "parcel.tabMedia" },
  { key: "calidad", label: "parcel.tabQuality" },
] as const satisfies ReadonlyArray<{ key: string; label: MessageKey }>;

export type ParcelTab = (typeof PARCEL_TABS)[number]["key"];

export function isParcelTab(value: string | undefined): value is ParcelTab {
  return PARCEL_TABS.some((tab) => tab.key === value);
}

export function ParcelWorkspace({
  view,
  tab,
  basePath,
  explorerPath,
  visits,
  canReadResponses,
  i18n,
}: {
  view: ParcelWorkspaceView;
  tab: ParcelTab;
  basePath: string;
  explorerPath: string;
  /** Null when the caller cannot see field data at all; empty when the parcel has no visits. */
  visits: ReadonlyArray<ParcelVisitEntry> | null;
  canReadResponses: boolean;
  i18n: I18n;
}) {
  const { t } = i18n;
  const { parcel } = view;

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.code}>{parcel.parcelCode}</h1>
          <p className={styles.meta}>
            {parcel.sectorLabel ?? t("gis.noSector")}
            {parcel.chainageM === null
              ? null
              : ` · ${t("gis.chainageAbbrev")} ${formatChainage(parcel.chainageM)}`}
            {` · ${t("gis.sideLine", { side: parcelSideLabel(t, parcel.side).toLowerCase() })}`}
            {view.alignmentLabel === null ? null : ` · ${view.alignmentLabel}`}
          </p>
        </div>
        <div className={styles.headerRight}>
          <Chip tone={parcel.status === "confirmed" ? "ok" : "neutral"}>
            <span aria-hidden="true">{PARCEL_STATUS_PRESENTATION[parcel.status].glyph}</span>{" "}
            {parcelStatusLabel(t, parcel.status)}
          </Chip>
          <ProvenanceBadge facets={parcel.provenance} t={t} />
          <ButtonLink href={explorerPath}>{t("parcel.backToExplorer")}</ButtonLink>
        </div>
      </div>

      <nav aria-label={t("parcel.sections")}>
        <ul className={styles.tabs}>
          {PARCEL_TABS.map((entry) => (
            <li key={entry.key}>
              <a
                aria-current={entry.key === tab ? "page" : undefined}
                className={`${styles.tab} ${entry.key === tab ? styles.tabCurrent : ""}`}
                href={`${basePath}?tab=${entry.key}`}
              >
                {t(entry.label)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "resumen" ? <SummaryTab basePath={basePath} i18n={i18n} view={view} /> : null}
      {tab === "afectaciones" ? (
        <AffectationsTab basePath={basePath} i18n={i18n} view={view} />
      ) : null}
      {tab === "visitas" ? (
        <VisitsTab canReadResponses={canReadResponses} i18n={i18n} visits={visits} />
      ) : null}
      {tab === "instrumentos" ? (
        <PendingModule
          capability="field.surveys"
          label={t("parcel.tabInstruments")}
          note={t("parcel.instrumentsNote")}
          t={t}
        />
      ) : null}
      {tab === "media" ? (
        <PendingModule
          capability="field.surveys"
          label={t("parcel.tabMedia")}
          note={t("parcel.mediaNote")}
          t={t}
        />
      ) : null}
      {tab === "calidad" ? (
        <PendingModule
          capability="quality.document_gate"
          label={t("parcel.tabQuality")}
          note={t("parcel.qualityNote")}
          t={t}
        />
      ) : null}
    </div>
  );
}

function SummaryTab({
  view,
  basePath,
  i18n: { t, fmt },
}: {
  view: ParcelWorkspaceView;
  basePath: string;
  i18n: I18n;
}) {
  const { parcel } = view;
  return (
    <div className={styles.grid}>
      <Panel>
        <PanelHeader
          label={t("parcel.location")}
          badge={
            view.datasetVersion ? (
              <ProvenanceBadge facets={view.datasetVersion.provenance} t={t} />
            ) : null
          }
        />
        <PanelBody>
          {view.geometry === null ? (
            <p className={styles.muted}>{t("parcel.noGeometry")}</p>
          ) : (
            <div className={styles.mapBox}>
              <ParcelGeometryMap
                bounds={view.bounds}
                geometry={view.geometry}
                label={parcel.parcelCode}
              />
            </div>
          )}
          {view.datasetVersion ? (
            <p className={styles.muted} style={{ marginTop: 10 }}>
              {t("parcel.layerLine", {
                layer: layerLegendLabel(t, view.datasetVersion.legend),
                version: view.datasetVersion.versionLabel,
              })}{" "}
              <ProvenanceLink
                href={`${basePath}?tab=resumen&prov=${view.datasetVersion.provenanceId}`}
              >
                {t("parcel.viewLayerProvenance")}
              </ProvenanceLink>
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label={t("parcel.territorialRecord")} />
        <PanelBody>
          <dl className={styles.facts}>
            <div>
              <dt>{t("common.status")}</dt>
              <dd>{parcelStatusLabel(t, parcel.status)}</dd>
            </div>
            <div>
              <dt>{t("gis.chainage")}</dt>
              <dd>
                {parcel.chainageM === null ? t("common.missing") : formatChainage(parcel.chainageM)}
              </dd>
            </div>
            <div>
              <dt>{t("parcel.chainageMethod")}</dt>
              <dd>
                {parcel.chainageMethod === null
                  ? t("common.missing")
                  : chainageMethodLabel(t, parcel.chainageMethod)}
              </dd>
            </div>
            <div>
              <dt>{t("gis.side")}</dt>
              <dd>{parcelSideLabel(t, parcel.side)}</dd>
            </div>
            <div>
              <dt>{t("gis.frontage")}</dt>
              <dd>
                {parcel.frontageM === null
                  ? t("common.missing")
                  : `${fmt.decimal(parcel.frontageM)} m`}
              </dd>
            </div>
            <div>
              <dt>{t("gis.totalArea")}</dt>
              <dd>
                {parcel.areaM2 === null
                  ? t("common.missing")
                  : `${fmt.decimal(parcel.areaM2 / 10_000, 2)} ha`}
              </dd>
            </div>
          </dl>
          <p className={styles.muted} style={{ marginTop: 12 }}>
            <ProvenanceLink href={`${basePath}?tab=resumen&prov=${parcel.provenanceId}`}>
              {t("parcel.viewParcelProvenance")}
            </ProvenanceLink>
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}

function AffectationsTab({
  view,
  basePath,
  i18n: { t, fmt },
}: {
  view: ParcelWorkspaceView;
  basePath: string;
  i18n: I18n;
}) {
  const { parcel } = view;
  if (view.affectations.length === 0) {
    return <p className={styles.muted}>{t("parcel.noAffectations")}</p>;
  }
  return (
    <Panel>
      <PanelHeader label={t("parcel.affectationsTitle")} />
      <PanelBody>
        <table className={styles.affectations}>
          <caption className={styles.srOnly}>
            {t("parcel.affectationsCaption", { code: parcel.parcelCode })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t("parcel.category")}</th>
              <th className={styles.numeric} scope="col">
                {t("parcel.affectedArea")}
              </th>
              <th className={styles.numeric} scope="col">
                {t("parcel.shareOfParcel")}
              </th>
              <th scope="col">{t("parcel.provenanceColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {view.affectations.map((affectation) => (
              <tr key={affectation.id}>
                <td>{affectationCategoryLabel(t, affectation.category)}</td>
                <td className={styles.numeric}>
                  {fmt.decimal(affectation.affectedAreaM2 / 10_000, 3)} ha
                </td>
                <td className={styles.numeric}>
                  {affectation.ratioOfParcel === null
                    ? t("common.missing")
                    : fmt.percent(affectation.ratioOfParcel)}
                </td>
                <td>
                  <ProvenanceLink
                    href={`${basePath}?tab=afectaciones&prov=${affectation.provenanceId}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.muted} style={{ marginTop: 12 }}>
          {t("parcel.affectationsNote")}
        </p>
      </PanelBody>
    </Panel>
  );
}

/**
 * The Visits tab, now a real field read model.
 *
 * It reports **that** a visit happened and whether a response was submitted — never an answer.
 * Being able to open a parcel does not make someone entitled to read what a household said, so the
 * individual answers stay behind `field.responses.read` and this tab says so rather than quietly
 * showing an empty list.
 */
function VisitsTab({
  visits,
  canReadResponses,
  i18n: { t, fmt },
}: {
  visits: ReadonlyArray<ParcelVisitEntry> | null;
  canReadResponses: boolean;
  i18n: I18n;
}) {
  if (visits === null) {
    return (
      <SystemState
        state="permission denied"
        title={t("parcel.visitsDeniedTitle")}
        meta="field.surveys"
      >
        <p>{t("parcel.visitsDeniedBody")}</p>
      </SystemState>
    );
  }

  if (visits.length === 0) {
    return <p className={styles.muted}>{t("parcel.noVisits")}</p>;
  }

  return (
    <Panel>
      <PanelHeader label={t("parcel.visitsTitle")} />
      <PanelBody>
        <table className={styles.affectations}>
          <caption className={styles.srOnly}>{t("parcel.visitsCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("parcel.visitStart")}</th>
              <th scope="col">{t("parcel.technician")}</th>
              <th scope="col">{t("common.status")}</th>
              <th scope="col">{t("parcel.form")}</th>
              <th scope="col">{t("parcel.provenanceColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((visit) => (
              <tr key={visit.visitId}>
                <td>{fmt.dateTime(visit.startedAt)}</td>
                {/* A synthetic display name, never a respondent. */}
                <td>{visit.technicianLabel}</td>
                <td>
                  {visitStatusLabel(t, visit.status)}
                  <span className={styles.visitNote}>
                    {locationOutcomeLabel(t, visit.locationOutcome)}
                  </span>
                </td>
                <td>
                  {visit.instanceStatus === null
                    ? t("common.missing")
                    : instanceStatusLabel(t, visit.instanceStatus)}
                  <span className={styles.visitNote}>{visit.surveyVersionLabel}</span>
                </td>
                <td>
                  <ProvenanceBadge facets={visit.provenance} t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.muted} style={{ marginTop: 12 }}>
          {canReadResponses
            ? t("parcel.visitsNoteWithAccess")
            : t("parcel.visitsNoteWithoutAccess")}
        </p>
      </PanelBody>
    </Panel>
  );
}

function PendingModule({
  label,
  capability,
  note,
  t,
}: {
  label: string;
  capability: string;
  note: string;
  t: I18n["t"];
}) {
  return (
    <SystemState
      state="module not implemented"
      title={t("parcel.pendingTitle", { label })}
      meta={capability}
    >
      <p>{note}</p>
    </SystemState>
  );
}
