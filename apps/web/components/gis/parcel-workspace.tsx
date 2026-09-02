import type { ParcelVisitEntry, ParcelWorkspaceView } from "@eia/application";
import {
  AFFECTATION_CATEGORY_LABEL,
  CHAINAGE_METHOD_LABEL,
  formatChainage,
  INSTANCE_STATUS_LABEL,
  LAYER_LEGEND_COPY,
  LOCATION_OUTCOME_LABEL,
  PARCEL_SIDE_LABEL,
  PARCEL_STATUS_PRESENTATION,
  VISIT_STATUS_LABEL,
} from "@eia/domain";
import {
  Chip,
  formatDecimal,
  formatPercent,
  formatDateTime,
  Panel,
  PanelBody,
  PanelHeader,
  ProvenanceBadge,
  SystemState,
} from "@eia/ui";

import { ButtonLink, ProvenanceLink } from "@/components/navigation";

import { ParcelGeometryMap } from "./parcel-geometry-map";
import styles from "./parcel-workspace.module.css";

/**
 * Parcel Workspace tabs (invariant 7: the parcel is the master territorial workspace). Only the
 * tabs whose modules exist are rendered as surfaces; the rest declare plainly that the module has
 * no data yet rather than showing an invented one.
 */
export const PARCEL_TABS = [
  { key: "resumen", label: "Resumen" },
  { key: "afectaciones", label: "Afectaciones" },
  { key: "visitas", label: "Visitas" },
  { key: "instrumentos", label: "Instrumentos" },
  { key: "media", label: "Media" },
  { key: "calidad", label: "Calidad" },
] as const;

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
}: {
  view: ParcelWorkspaceView;
  tab: ParcelTab;
  basePath: string;
  explorerPath: string;
  /** Null when the caller cannot see field data at all; empty when the parcel has no visits. */
  visits: ReadonlyArray<ParcelVisitEntry> | null;
  canReadResponses: boolean;
}) {
  const { parcel } = view;
  const status = PARCEL_STATUS_PRESENTATION[parcel.status];

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.code}>{parcel.parcelCode}</h1>
          <p className={styles.meta}>
            {parcel.sectorLabel ?? "Sin sector"}
            {parcel.chainageM === null ? null : ` · ABS ${formatChainage(parcel.chainageM)}`}
            {` · lado ${PARCEL_SIDE_LABEL[parcel.side].toLowerCase()}`}
            {view.alignmentLabel === null ? null : ` · ${view.alignmentLabel}`}
          </p>
        </div>
        <div className={styles.headerRight}>
          <Chip tone={parcel.status === "confirmed" ? "ok" : "neutral"}>
            <span aria-hidden="true">{status.glyph}</span> {status.label}
          </Chip>
          <ProvenanceBadge facets={parcel.provenance} />
          <ButtonLink href={explorerPath}>Volver al explorador</ButtonLink>
        </div>
      </div>

      <nav aria-label="Secciones del predio">
        <ul className={styles.tabs}>
          {PARCEL_TABS.map((entry) => (
            <li key={entry.key}>
              <a
                aria-current={entry.key === tab ? "page" : undefined}
                className={`${styles.tab} ${entry.key === tab ? styles.tabCurrent : ""}`}
                href={`${basePath}?tab=${entry.key}`}
              >
                {entry.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "resumen" ? <SummaryTab basePath={basePath} view={view} /> : null}
      {tab === "afectaciones" ? <AffectationsTab basePath={basePath} view={view} /> : null}
      {tab === "visitas" ? <VisitsTab canReadResponses={canReadResponses} visits={visits} /> : null}
      {tab === "instrumentos" ? (
        <PendingModule
          capability="field.surveys"
          label="Instrumentos"
          note="Las fichas socioeconómicas y demás instrumentos se listarán aquí cuando la bandeja de campo esté implementada."
        />
      ) : null}
      {tab === "media" ? (
        <PendingModule
          capability="field.surveys"
          label="Media"
          note="Las fotografías y evidencias de campo llegan con la captura móvil. No hay archivos asociados a este predio."
        />
      ) : null}
      {tab === "calidad" ? (
        <PendingModule
          capability="quality.document_gate"
          label="Calidad"
          note="Los hallazgos del Quality Gate referidos a este predio se mostrarán aquí cuando el módulo esté implementado."
        />
      ) : null}
    </div>
  );
}

function SummaryTab({ view, basePath }: { view: ParcelWorkspaceView; basePath: string }) {
  const { parcel } = view;
  return (
    <div className={styles.grid}>
      <Panel>
        <PanelHeader
          label="Ubicación"
          badge={
            view.datasetVersion ? <ProvenanceBadge facets={view.datasetVersion.provenance} /> : null
          }
        />
        <PanelBody>
          {view.geometry === null ? (
            <p className={styles.muted}>
              Este predio no tiene geometría activa. Su ficha existe, pero no puede representarse en
              el mapa hasta que se cargue el polígono.
            </p>
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
              Capa: {LAYER_LEGEND_COPY[view.datasetVersion.legend].label} ·{" "}
              {view.datasetVersion.versionLabel}{" "}
              <ProvenanceLink
                href={`${basePath}?tab=resumen&prov=${view.datasetVersion.provenanceId}`}
              >
                Ver origen de la capa
              </ProvenanceLink>
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label="Ficha territorial" />
        <PanelBody>
          <dl className={styles.facts}>
            <div>
              <dt>Estado</dt>
              <dd>{PARCEL_STATUS_PRESENTATION[parcel.status].label}</dd>
            </div>
            <div>
              <dt>Abscisa</dt>
              <dd>{parcel.chainageM === null ? "—" : formatChainage(parcel.chainageM)}</dd>
            </div>
            <div>
              <dt>Método de abscisado</dt>
              <dd>
                {parcel.chainageMethod === null
                  ? "—"
                  : CHAINAGE_METHOD_LABEL[parcel.chainageMethod]}
              </dd>
            </div>
            <div>
              <dt>Lado</dt>
              <dd>{PARCEL_SIDE_LABEL[parcel.side]}</dd>
            </div>
            <div>
              <dt>Frente sobre la vía</dt>
              <dd>{parcel.frontageM === null ? "—" : `${formatDecimal(parcel.frontageM)} m`}</dd>
            </div>
            <div>
              <dt>Área total</dt>
              <dd>
                {parcel.areaM2 === null ? "—" : `${formatDecimal(parcel.areaM2 / 10_000, 2)} ha`}
              </dd>
            </div>
          </dl>
          <p className={styles.muted} style={{ marginTop: 12 }}>
            <ProvenanceLink href={`${basePath}?tab=resumen&prov=${parcel.provenanceId}`}>
              Ver origen de los datos del predio
            </ProvenanceLink>
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}

function AffectationsTab({ view, basePath }: { view: ParcelWorkspaceView; basePath: string }) {
  const { parcel } = view;
  if (view.affectations.length === 0) {
    return (
      <p className={styles.muted}>
        No hay afectaciones registradas para este predio en la versión activa de la capa.
      </p>
    );
  }
  return (
    <Panel>
      <PanelHeader label="Afectaciones estimadas" />
      <PanelBody>
        <table className={styles.affectations}>
          <caption className={styles.srOnly}>
            Afectaciones estimadas del predio {parcel.parcelCode}
          </caption>
          <thead>
            <tr>
              <th scope="col">Categoría</th>
              <th className={styles.numeric} scope="col">
                Área afectada
              </th>
              <th className={styles.numeric} scope="col">
                % del predio
              </th>
              <th scope="col">Origen</th>
            </tr>
          </thead>
          <tbody>
            {view.affectations.map((affectation) => (
              <tr key={affectation.id}>
                <td>{AFFECTATION_CATEGORY_LABEL[affectation.category]}</td>
                <td className={styles.numeric}>
                  {formatDecimal(affectation.affectedAreaM2 / 10_000, 3)} ha
                </td>
                <td className={styles.numeric}>
                  {affectation.ratioOfParcel === null
                    ? "—"
                    : formatPercent(affectation.ratioOfParcel)}
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
          Las áreas se calculan sobre la geometría activa; son una estimación cartográfica, no una
          medición de campo ni un avalúo.
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
}: {
  visits: ReadonlyArray<ParcelVisitEntry> | null;
  canReadResponses: boolean;
}) {
  if (visits === null) {
    return (
      <SystemState
        state="permission denied"
        title="Visitas: sin acceso al trabajo de campo"
        meta="field.surveys"
      >
        <p>
          Tu rol puede consultar el predio pero no el trabajo de campo asociado. Acceder al
          expediente territorial no otorga por sí solo acceso a las visitas.
        </p>
      </SystemState>
    );
  }

  if (visits.length === 0) {
    return (
      <p className={styles.muted}>
        No hay visitas registradas para este predio. Cuando un técnico inicie una visita de una
        campaña activa, aparecerá aquí.
      </p>
    );
  }

  return (
    <Panel>
      <PanelHeader label="Visitas de campo" />
      <PanelBody>
        <table className={styles.affectations}>
          <caption className={styles.srOnly}>
            Visitas de campo registradas para este predio. Muestra el estado del trabajo, no las
            respuestas individuales.
          </caption>
          <thead>
            <tr>
              <th scope="col">Inicio</th>
              <th scope="col">Técnico</th>
              <th scope="col">Estado</th>
              <th scope="col">Ficha</th>
              <th scope="col">Origen</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((visit) => (
              <tr key={visit.visitId}>
                <td>{formatDateTime(visit.startedAt)}</td>
                {/* A synthetic display name, never a respondent. */}
                <td>{visit.technicianLabel}</td>
                <td>
                  {VISIT_STATUS_LABEL[visit.status]}
                  <span className={styles.visitNote}>
                    {LOCATION_OUTCOME_LABEL[visit.locationOutcome]}
                  </span>
                </td>
                <td>
                  {visit.instanceStatus === null
                    ? "—"
                    : INSTANCE_STATUS_LABEL[visit.instanceStatus]}
                  <span className={styles.visitNote}>{visit.surveyVersionLabel}</span>
                </td>
                <td>
                  <ProvenanceBadge facets={visit.provenance} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.muted} style={{ marginTop: 12 }}>
          {canReadResponses
            ? "Las respuestas individuales se consultan desde Social Intelligence, que llega en una fase posterior."
            : "Se muestra el estado del trabajo de campo. Ver una respuesta individual requiere el permiso field.responses.read."}
        </p>
      </PanelBody>
    </Panel>
  );
}

function PendingModule({
  label,
  capability,
  note,
}: {
  label: string;
  capability: string;
  note: string;
}) {
  return (
    <SystemState state="module not implemented" title={`${label}: aún sin datos`} meta={capability}>
      <p>{note}</p>
    </SystemState>
  );
}
