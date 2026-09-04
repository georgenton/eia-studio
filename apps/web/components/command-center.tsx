import type { CommandCenterView, FieldProgressSummary, TerritorialSummary } from "@eia/application";
import {
  ATTENTION_SEVERITY_LABEL,
  demoScenarioDate,
  LAYER_LEGEND_COPY,
  PARCEL_STATUS_PRESENTATION,
  selectLayerByKind,
  SURFACE_DEFINITIONS,
  type MetricKey,
  type MetricSnapshot,
  type ParcelStatus,
  type ProvenanceFacets,
  type RequestContext,
} from "@eia/domain";
import {
  ActivityTable,
  AttentionList,
  AttentionRow,
  Chip,
  Columns,
  DemoBadge,
  ForecastChart,
  MetricCell,
  MetricStrip,
  Mono,
  Panel,
  PanelBody,
  PanelHeader,
  ProvenanceBadge,
  Stack,
  StatusChip,
  SystemState,
  formatCount,
  formatDayCount,
  formatDecimal,
  formatIsoDate,
  formatMetricValue,
  formatTime,
} from "@eia/ui";
import { ProvenanceLink } from "@/components/navigation";

import { projectPath } from "@/lib/navigation";

import styles from "./command-center.module.css";

/** KPI strip order of the approved design; a metric absent from the project is simply skipped. */
const STRIP_ORDER: ReadonlyArray<MetricKey> = [
  "universe_estimated",
  "universe_confirmed",
  "parcels_visited",
  "surveys_complete",
  "revisits_scheduled",
  "parcels_pending",
  "productivity_per_day",
  "projected_close_date",
];

function provHref(base: string, provenanceId: string): string {
  return `${base}?prov=${provenanceId}`;
}

function metricTone(metric: MetricSnapshot): "default" | "warn" | "crit" {
  if (metric.key === "projected_close_date") return "crit";
  if (metric.key === "parcels_pending") return "crit";
  if (metric.key === "revisits_scheduled") return "warn";
  return "default";
}

export function CommandCenter({
  ctx,
  view,
  basePath,
  lifecycleLabel,
  territory,
  gisPath,
  fieldProgress,
  fieldPath,
}: {
  ctx: RequestContext;
  view: CommandCenterView;
  basePath: string;
  lifecycleLabel: string;
  /** Null when the project has no geometry, or when `gis.parcels` is not effective. */
  territory: TerritorialSummary | null;
  gisPath: string | null;
  /** Null when there is no campaign, or when `field.surveys` is not effective. */
  fieldProgress: FieldProgressSummary | null;
  fieldPath: string | null;
}) {
  const byKey = new Map(view.metrics.map((m) => [m.key, m]));
  const strip = STRIP_ORDER.map((key) => byKey.get(key)).filter(
    (m): m is MetricSnapshot => m !== undefined,
  );
  const stripFacets: ProvenanceFacets[] = strip.map((m) => m.provenance);
  const length = byKey.get("corridor_length_km");
  const consultation = byKey.get("consultation_participants");
  const forecast = view.forecast;
  // The scenario clock (IG1-003, IG1-009): demo values belong to a fixed as-of date, never to
  // "today". It comes from the simulated forecast that is anchored to it — the project entity
  // carries no demo state.
  const scenarioDate = forecast ? demoScenarioDate(forecast, forecast.provenance) : null;
  const scenarioLabel = scenarioDate
    ? `Escenario demo · fecha de corte: ${formatIsoDate(scenarioDate)}`
    : null;

  return (
    <Stack gap={16}>
      <Panel>
        <PanelBody className={styles.header}>
          <div className={styles.headerMain}>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{view.project.name}</h1>
              <StatusChip label={lifecycleLabel} tone="ok" />
              {forecast && forecast.delayDays > 0 ? (
                <StatusChip
                  label={`Retraso proyectado ${formatDayCount(forecast.delayDays)}`}
                  tone="warn"
                />
              ) : null}
            </div>
            <p className={styles.subtitle}>
              {view.project.locationLabel ? <span>{view.project.locationLabel}</span> : null}
              {length && length.numericValue !== null ? (
                <span>{formatDecimal(length.numericValue)} km</span>
              ) : null}
              <span>
                perfil <Mono>{view.project.profileKey}</Mono>
              </span>
            </p>
          </div>
          {forecast ? (
            <dl className={styles.meta}>
              <div>
                <dt>Fecha objetivo</dt>
                <dd>{formatIsoDate(forecast.targetDate)}</dd>
              </div>
              <div>
                <dt>Proyección</dt>
                <dd className={forecast.delayDays > 0 ? styles.late : undefined}>
                  {formatIsoDate(forecast.projectedCloseDate)}
                </dd>
              </div>
              <div>
                <dt>Rol en el proyecto</dt>
                <dd>{view.projectRole ?? `${view.tenantRole} (acceso implícito)`}</dd>
              </div>
              <div>
                <dt>{scenarioLabel ? "Fecha de corte del escenario" : "Última actualización"}</dt>
                <dd>{formatIsoDate(forecast.calculatedAt.toISOString().slice(0, 10))}</dd>
              </div>
            </dl>
          ) : null}
        </PanelBody>
      </Panel>

      {strip.length === 0 ? (
        <SystemState state="empty" title="Sin métricas todavía">
          <p>Cuando el equipo registre avance, el control de ejecución aparecerá aquí.</p>
        </SystemState>
      ) : (
        <Panel>
          <PanelHeader
            label="Control de ejecución"
            badge={
              <>
                <DemoBadge facets={stripFacets} />
                {scenarioLabel ? <Chip tone="demo">{scenarioLabel}</Chip> : null}
              </>
            }
            note="Universo, levantamientos y consulta son cifras reales del estudio; el resto son métricas operativas de demostración, fijadas a la fecha de corte del escenario."
          />
          <MetricStrip label="Control de ejecución">
            {strip.map((metric) => (
              <MetricCell
                key={metric.id}
                label={metric.definition.label}
                value={formatMetricValue(metric)}
                tone={metricTone(metric)}
                note={
                  <>
                    {metric.note ? <span>{metric.note}</span> : null}
                    <span className={styles.badgeRow}>
                      <ProvenanceBadge facets={metric.provenance} />
                    </span>
                  </>
                }
                provenanceLink={<ProvenanceLink href={provHref(basePath, metric.provenanceId)} />}
              />
            ))}
          </MetricStrip>
        </Panel>
      )}

      <Columns>
        <Stack gap={16}>
          {forecast ? (
            <Panel>
              <PanelHeader
                label="Proyección operativa"
                note="cálculo aritmético sobre el ritmo observado · sin modelo predictivo"
                action={<ProvenanceLink href={provHref(basePath, forecast.provenanceId)} />}
              />
              <PanelBody>
                <p className={styles.statement}>
                  Al ritmo de los últimos {forecast.windowDays} días, el levantamiento concluiría{" "}
                  {forecast.delayDays > 0 ? (
                    <strong className={styles.late}>
                      {formatDayCount(forecast.delayDays)} después
                    </strong>
                  ) : forecast.delayDays < 0 ? (
                    <strong>{formatDayCount(forecast.delayDays)} antes</strong>
                  ) : (
                    <strong>el mismo día</strong>
                  )}{" "}
                  de la fecha objetivo.
                </p>
                <div className={styles.forecastGrid}>
                  <div className={styles.forecastCells}>
                    <ForecastCell
                      label="Ritmo actual"
                      value={formatDecimal(forecast.movingAveragePerDay)}
                      unit="pred/día"
                    />
                    <ForecastCell
                      label="Ritmo necesario"
                      value={
                        forecast.requiredRatePerDay === null
                          ? "—"
                          : formatDecimal(forecast.requiredRatePerDay)
                      }
                      unit="pred/día"
                      highlight
                    />
                    <ForecastCell
                      label="Técnicos activos"
                      value={formatCount(forecast.activeTechnicians)}
                      unit={`de ${formatCount(forecast.assignedTechnicians)} asignados`}
                    />
                    <ForecastCell
                      label="Pendientes"
                      value={formatCount(forecast.pending)}
                      unit="predios"
                    />
                  </div>
                  <div className={styles.forecastChart}>
                    <span className={styles.chartLabel}>
                      Levantamientos por día · últimos {forecast.dailyCompletions.length} días
                    </span>
                    <ForecastChart
                      values={forecast.dailyCompletions}
                      highlightLast={forecast.windowDays}
                      startDate={shiftDate(
                        forecast.calculatedAt,
                        -(forecast.dailyCompletions.length - 1),
                      )}
                      endDate={forecast.calculatedAt.toISOString().slice(0, 10)}
                      label={`Levantamientos por día, últimos ${forecast.dailyCompletions.length} días`}
                    />
                    <p className={styles.assumptions}>
                      <span className={styles.assumptionsLabel}>Supuestos:</span>{" "}
                      {forecast.assumptions.join(" · ")}
                    </p>
                    <p className={styles.algorithm}>
                      <Mono>{forecast.algorithmVersion}</Mono>
                    </p>
                  </div>
                </div>
              </PanelBody>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader
              label="Requiere atención hoy"
              action={<span className={styles.count}>{view.attention.length} elementos</span>}
            />
            {view.attention.length === 0 ? (
              <PanelBody>
                <p className={styles.muted}>
                  Nada requiere atención hoy. Esto no sustituye la revisión técnica del expediente.
                </p>
              </PanelBody>
            ) : (
              <AttentionList>
                {view.attention.map((item) => {
                  const surface = item.surface ? SURFACE_DEFINITIONS[item.surface] : null;
                  const href =
                    surface && surface.implemented && ctx.projectSlug
                      ? projectPath(ctx.tenantSlug, ctx.projectSlug, surface.segment)
                      : null;
                  return (
                    <AttentionRow
                      key={item.id}
                      severity={item.severity}
                      severityLabel={ATTENTION_SEVERITY_LABEL[item.severity]}
                      title={item.title}
                      note={item.note}
                      surfaceLabel={item.surfaceLabel}
                      action={
                        href ? (
                          <ProvenanceLink href={href}>{item.actionLabel ?? "Abrir"}</ProvenanceLink>
                        ) : (
                          <ProvenanceLink href={provHref(basePath, item.provenanceId)} />
                        )
                      }
                    />
                  );
                })}
              </AttentionList>
            )}
          </Panel>

          {view.activity.length > 0 ? (
            <Panel>
              <PanelHeader
                label="Actividad reciente"
                badge={<DemoBadge facets={view.activity.map((a) => a.provenance)} />}
                note={scenarioLabel ?? undefined}
              />
              <ActivityTable
                caption="Actividad reciente del proyecto"
                rows={view.activity.map((event) => ({
                  id: event.id,
                  time: formatTime(event.occurredAt),
                  actor: event.actorLabel,
                  action: event.action,
                  object: event.objectLabel,
                }))}
              />
            </Panel>
          ) : null}
        </Stack>

        <Stack gap={16}>
          {consultation ? (
            <Panel>
              <PanelHeader label="Consulta significativa" badge={<Chip tone="ok">COMPLETA</Chip>} />
              <PanelBody>
                <div className={styles.bigFigure}>
                  <span className={styles.bigValue}>{formatMetricValue(consultation)}</span>
                  <span className={styles.bigNote}>{consultation.note}</span>
                </div>
                <div className={styles.badgeRow}>
                  <ProvenanceBadge facets={consultation.provenance} />
                  <ProvenanceLink href={provHref(basePath, consultation.provenanceId)} />
                </div>
              </PanelBody>
            </Panel>
          ) : null}

          {territory ? (
            <TerritorySummaryPanel basePath={basePath} gisPath={gisPath} territory={territory} />
          ) : null}

          {fieldProgress ? (
            <FieldProgressPanel
              basePath={basePath}
              fieldPath={fieldPath}
              progress={fieldProgress}
            />
          ) : null}

          <Panel>
            <PanelHeader label="Alcance de esta fase" />
            <PanelBody>
              <p className={styles.muted}>
                Los instrumentos del proyecto y los hallazgos de calidad llegan con los módulos de
                campo y control de calidad. No se muestran cifras inventadas en su lugar.
              </p>
            </PanelBody>
          </Panel>
        </Stack>
      </Columns>
    </Stack>
  );
}

/**
 * Territorial summary (TD-023, GIS portion). Every figure is counted from the active layers, and
 * the panel carries those layers' provenance: summarising a synthetic corridor does not make it
 * observed. Parcels still without geometry are stated rather than folded into the totals, which
 * is what the `partial GIS` state means.
 */
function TerritorySummaryPanel({
  territory,
  basePath,
  gisPath,
}: {
  territory: TerritorialSummary;
  basePath: string;
  gisPath: string | null;
}) {
  const statuses = (Object.keys(territory.byStatus) as ParcelStatus[]).filter(
    (status) => territory.byStatus[status] > 0,
  );
  // The panel summarises parcels, so it carries the parcels layer's provenance. Selected by kind,
  // never by position: a query's row order is not a fact (IG2-007).
  const layer = selectLayerByKind(territory.layers, "parcels");
  return (
    <Panel>
      <PanelHeader
        label="Resumen territorial"
        badge={layer ? <ProvenanceBadge facets={layer.provenance} /> : undefined}
        action={gisPath ? <ProvenanceLink href={gisPath}>Abrir GIS</ProvenanceLink> : undefined}
      />
      <PanelBody>
        <div className={styles.territoryHead}>
          <span className={styles.bigValue}>{formatCount(territory.parcelCount)}</span>
          <span className={styles.bigNote}>
            predios en el corredor
            {territory.alignmentLengthM === null
              ? ""
              : ` · ${formatDecimal(territory.alignmentLengthM / 1000, 1)} km de eje`}
          </span>
        </div>
        <ul className={styles.territoryList}>
          {statuses.map((status) => (
            <li className={styles.territoryRow} key={status}>
              <span aria-hidden="true" className={styles.territoryGlyph}>
                {PARCEL_STATUS_PRESENTATION[status].glyph}
              </span>
              <span>{PARCEL_STATUS_PRESENTATION[status].label}</span>
              <Mono>{formatCount(territory.byStatus[status])}</Mono>
            </li>
          ))}
          <li className={styles.territoryRow}>
            <span aria-hidden="true" className={styles.territoryGlyph} />
            <span>Superficie cartografiada</span>
            <Mono>{formatDecimal(territory.totalAreaM2 / 10_000, 1)} ha</Mono>
          </li>
          <li className={styles.territoryRow}>
            <span aria-hidden="true" className={styles.territoryGlyph} />
            <span>Afectación estimada</span>
            <Mono>{formatDecimal(territory.affectedAreaM2 / 10_000, 1)} ha</Mono>
          </li>
        </ul>
        {territory.withoutGeometry > 0 ? (
          <p className={styles.muted} data-system-state="partial gis">
            {formatCount(territory.withoutGeometry)} de {formatCount(territory.parcelCount)} predios
            aún no tienen geometría; las superficies de arriba sólo cubren los que sí la tienen.
          </p>
        ) : null}
        {layer ? (
          <p className={styles.muted}>
            {LAYER_LEGEND_COPY[layer.legend].label} · {LAYER_LEGEND_COPY[layer.legend].note}{" "}
            <ProvenanceLink href={provHref(basePath, layer.provenanceId)} />
          </p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/**
 * Current field operation, counted from the FieldFlow tables.
 *
 * It sits deliberately apart from the KPI strip's historical survey aggregate, which is a
 * verifiable figure from a concluded study. This panel is a *different observation about a
 * different thing*: a demonstration campaign running now, with its own provenance and its own
 * SYNTHETIC badge. The wording says so, because two survey counts on one screen is exactly the
 * confusion that turns a demo into a false claim.
 *
 * The historical figure itself is never written here — it is a metric from the project fixture,
 * and repeating it in a component would make one project's number a constant of the product.
 */
function FieldProgressPanel({
  progress,
  basePath,
  fieldPath,
}: {
  progress: FieldProgressSummary;
  basePath: string;
  fieldPath: string | null;
}) {
  return (
    <Panel>
      <PanelHeader
        label="Campaña de campo en curso"
        badge={<ProvenanceBadge facets={progress.provenance} />}
        action={
          fieldPath ? (
            <ProvenanceLink href={fieldPath}>Abrir el trabajo de campo</ProvenanceLink>
          ) : undefined
        }
      />
      <PanelBody>
        <div className={styles.territoryHead}>
          <span className={styles.bigValue}>
            {formatCount(progress.submittedCount)} / {formatCount(progress.progress.total)}
          </span>
          <span className={styles.bigNote}>fichas enviadas · {progress.campaignName}</span>
        </div>
        <ul className={styles.territoryList}>
          <li className={styles.territoryRow}>
            <span aria-hidden="true" className={styles.territoryGlyph} />
            <span>Asignaciones</span>
            <Mono>{formatCount(progress.progress.total)}</Mono>
          </li>
          <li className={styles.territoryRow}>
            <span aria-hidden="true" className={styles.territoryGlyph} />
            <span>Pendientes</span>
            <Mono>{formatCount(progress.progress.pending)}</Mono>
          </li>
          <li className={styles.territoryRow}>
            <span aria-hidden="true" className={styles.territoryGlyph} />
            <span>Completadas</span>
            <Mono>{formatCount(progress.progress.completed)}</Mono>
          </li>
        </ul>
        <p className={styles.muted}>
          Operación de demostración en curso. No forma parte de las encuestas socioeconómicas del
          estudio concluido, que son una cifra histórica agregada del expediente.{" "}
          <ProvenanceLink href={provHref(basePath, progress.provenanceId)} />
        </p>
      </PanelBody>
    </Panel>
  );
}

function ForecastCell({
  label,
  value,
  unit,
  highlight = false,
}: {
  label: string;
  value: string;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <div className={`${styles.forecastCell} ${highlight ? styles.forecastCellActive : ""}`}>
      <span className={styles.forecastLabel}>{label}</span>
      <span className={styles.forecastValue}>
        {value} <span className={styles.forecastUnit}>{unit}</span>
      </span>
    </div>
  );
}

function shiftDate(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
