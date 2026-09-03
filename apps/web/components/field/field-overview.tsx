import type { FieldOverview } from "@eia/application";
import {
  CAMPAIGN_STATUS_LABEL,
  captureChannel,
  FIELD_OFFLINE_MODE_SEMANTICS,
  type FieldOfflineMode,
} from "@eia/domain";
import {
  Chip,
  formatCount,
  formatPercent,
  Panel,
  PanelBody,
  PanelHeader,
  ProgressBar,
  ProvenanceBadge,
} from "@eia/ui";

import { ProvenanceLink } from "@/components/navigation";

import styles from "./field-overview.module.css";

/**
 * FieldFlow for a coordinator or social specialist: which campaign is running, how far it has got,
 * and who is carrying the work.
 *
 * Every number here is counted from the field tables by `loadFieldOverview` — none is a constant in
 * this file. That matters more than it sounds: the moment a progress figure is hardcoded it stops
 * being an observation and becomes a claim, and this panel sits on the same screen as a real
 * historical aggregate.
 *
 * It is not a planner. No scheduling, no routing, no forecasting: operational visibility is what a
 * coordinator needs from this slice, and workforce-management software is not something to grow by
 * accident.
 */
export function FieldOverviewSurface({
  overview,
  basePath,
  offlineMode,
}: {
  overview: FieldOverview;
  basePath: string;
  offlineMode: FieldOfflineMode;
}) {
  if (overview.campaigns.length === 0) {
    return (
      <div className={styles.empty} data-system-state="empty">
        <h1 className={styles.emptyTitle}>Todavía no hay campañas de campo</h1>
        <p className={styles.emptyNote}>
          Una campaña conecta un cuestionario publicado con las asignaciones de campo. Hasta que
          exista una, no hay avance que mostrar: esta superficie no inventa cifras.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.surface}>
      {overview.campaigns.map((campaign) => {
        const channel = captureChannel(campaign.captureChannel);
        const mode = campaign.offlineModeAtActivation ?? offlineMode;
        const semantics = FIELD_OFFLINE_MODE_SEMANTICS[mode];
        return (
          <Panel key={campaign.id}>
            <PanelHeader
              label="Campaña de campo"
              badge={<ProvenanceBadge facets={campaign.provenance} />}
              action={
                <ProvenanceLink href={`${basePath}?prov=${campaign.provenanceId}`}>
                  Ver origen
                </ProvenanceLink>
              }
            />
            <PanelBody>
              <div className={styles.head}>
                <div>
                  <h2 className={styles.name}>{campaign.name}</h2>
                  <p className={styles.meta}>
                    {campaign.surveyTemplateName} ·{" "}
                    {/* The version label is traceability, not decoration: a response resolves
                        against exactly this definition, for ever. */}
                    <span className={styles.version}>{campaign.surveyVersionLabel}</span>
                    {campaign.startsOn ? ` · desde ${campaign.startsOn}` : ""}
                    {campaign.targetOn ? ` · meta ${campaign.targetOn}` : ""}
                  </p>
                </div>
                <Chip tone={campaign.status === "ACTIVE" ? "ok" : "neutral"}>
                  {CAMPAIGN_STATUS_LABEL[campaign.status]}
                </Chip>
              </div>

              <dl className={styles.channel}>
                <div>
                  <dt>Canal de captura</dt>
                  <dd>{channel.label}</dd>
                </div>
                <div>
                  <dt>Captura offline</dt>
                  {/* Stated as it is. Saying "offline disponible" for a channel that posts to the
                      server would cost a technician a day of work in a valley with no signal. */}
                  <dd>
                    {semantics.label}
                    <span className={styles.channelNote}>
                      {channel.supportsOffline
                        ? "El canal declara soporte offline."
                        : "El canal web requiere conexión al enviar; no hay cola offline."}
                    </span>
                  </dd>
                </div>
              </dl>

              <div className={styles.progress}>
                <ProgressBar
                  ratio={campaign.progress.completionRatio ?? 0}
                  label="Avance de la campaña"
                  valueLabel={`${formatCount(campaign.submittedCount)} / ${formatCount(
                    campaign.progress.total,
                  )} enviadas${
                    campaign.progress.completionRatio === null
                      ? ""
                      : ` · ${formatPercent(campaign.progress.completionRatio)}`
                  }`}
                />
                <ul className={styles.counts}>
                  <li>
                    <span>Asignadas</span>
                    <strong>{formatCount(campaign.progress.total)}</strong>
                  </li>
                  <li>
                    <span>Pendientes</span>
                    <strong>{formatCount(campaign.progress.pending)}</strong>
                  </li>
                  <li>
                    <span>En curso</span>
                    <strong>{formatCount(campaign.progress.inProgress)}</strong>
                  </li>
                  <li>
                    <span>Completadas</span>
                    <strong>{formatCount(campaign.progress.completed)}</strong>
                  </li>
                  <li>
                    <span>Enviadas</span>
                    <strong>{formatCount(campaign.submittedCount)}</strong>
                  </li>
                </ul>
              </div>
            </PanelBody>
          </Panel>
        );
      })}

      <Panel>
        <PanelHeader label="Carga por técnico" />
        <PanelBody>
          {overview.workload.length === 0 ? (
            <p className={styles.emptyNote}>Todavía no hay asignaciones repartidas.</p>
          ) : (
            <table className={styles.workload}>
              <caption className={styles.srOnly}>
                Asignaciones por técnico. Son recuentos: esta vista no muestra respuestas
                individuales.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Técnico</th>
                  <th scope="col">Pendientes</th>
                  <th scope="col">En curso</th>
                  <th scope="col">Completadas</th>
                </tr>
              </thead>
              <tbody>
                {overview.workload.map((row) => (
                  <tr key={row.userId}>
                    <td>{row.displayName}</td>
                    <td className={styles.numeric}>{formatCount(row.pending)}</td>
                    <td className={styles.numeric}>{formatCount(row.inProgress)}</td>
                    <td className={styles.numeric}>{formatCount(row.completed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={styles.footnote}>
            Recuentos de trabajo, no respuestas. Ver una respuesta individual requiere el permiso{" "}
            <code>field.responses.read</code>.
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}
