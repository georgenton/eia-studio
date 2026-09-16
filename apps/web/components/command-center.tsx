import type { CommandCenterView, FieldProgressSummary, TerritorialSummary } from "@eia/application";
import {
  demoScenarioDate,
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
  formatMetricValue,
} from "@eia/ui";
import { ProvenanceLink } from "@/components/navigation";

import type { I18n } from "@/lib/locale";
import {
  attentionSeverityLabel,
  dayCount,
  layerLegendLabel,
  layerLegendNote,
  parcelStatusLabel,
  surfaceLabel,
  projectRoleLabel,
  tenantRoleLabel,
} from "@/lib/labels";
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
  i18n,
  view,
  basePath,
  lifecycleLabel,
  territory,
  gisPath,
  fieldProgress,
  fieldPath,
}: {
  ctx: RequestContext;
  i18n: I18n;
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
  const { t, fmt } = i18n;
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
    ? t("commandCenter.scenarioBadge", { date: fmt.isoDate(scenarioDate) })
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
                  label={t("commandCenter.delayChip", {
                    days: dayCount(t, forecast.delayDays, fmt.count(Math.abs(forecast.delayDays))),
                  })}
                  tone="warn"
                />
              ) : null}
            </div>
            {view.project.officialTitle ? (
              /*
               * The name on the terms of reference, not the one the team says out loud. A
               * workspace for a real study should say which study it is, in the words the
               * deliverable will be filed under.
               */
              <p className={styles.officialTitle}>
                {view.project.officialTitle}
                {view.project.programmeReference ? (
                  <Chip mono tone="neutral">
                    {view.project.programmeReference}
                  </Chip>
                ) : null}
              </p>
            ) : null}
            <p className={styles.subtitle}>
              {view.project.locationLabel ? <span>{view.project.locationLabel}</span> : null}
              {length && length.numericValue !== null ? (
                <span>{fmt.decimal(length.numericValue)} km</span>
              ) : null}
              <span>
                {t("commandCenter.profileLine", {
                  profile: t(
                    `vocabulary.profile.${view.project.profileKey}` as Parameters<typeof t>[0],
                  ),
                })}
              </span>
            </p>
          </div>
          {forecast ? (
            <dl className={styles.meta}>
              <div>
                <dt>{t("commandCenter.targetDate")}</dt>
                <dd>{fmt.isoDate(forecast.targetDate)}</dd>
              </div>
              <div>
                <dt>{t("commandCenter.projection")}</dt>
                <dd className={forecast.delayDays > 0 ? styles.late : undefined}>
                  {fmt.isoDate(forecast.projectedCloseDate)}
                </dd>
              </div>
              <div>
                <dt>{t("commandCenter.projectRole")}</dt>
                <dd>
                  {view.projectRole
                    ? projectRoleLabel(t, view.projectRole)
                    : t("commandCenter.implicitAccess", {
                        role: tenantRoleLabel(t, view.tenantRole),
                      })}
                </dd>
              </div>
              <div>
                <dt>
                  {scenarioLabel
                    ? t("commandCenter.scenarioCutoff")
                    : t("commandCenter.lastUpdated")}
                </dt>
                <dd>{fmt.isoDate(forecast.calculatedAt.toISOString().slice(0, 10))}</dd>
              </div>
            </dl>
          ) : null}
        </PanelBody>
      </Panel>

      {strip.length === 0 ? (
        <SystemState state="empty" title={t("commandCenter.noMetricsTitle")}>
          <p>{t("commandCenter.noMetricsBody")}</p>
        </SystemState>
      ) : (
        <Panel>
          <PanelHeader
            label={t("commandCenter.executionControl")}
            badge={
              <>
                <DemoBadge facets={stripFacets} t={t} />
                {scenarioLabel ? <Chip tone="demo">{scenarioLabel}</Chip> : null}
              </>
            }
            note={t("commandCenter.executionNote")}
          />
          <MetricStrip label={t("commandCenter.executionControl")}>
            {strip.map((metric) => (
              <MetricCell
                key={metric.id}
                label={metric.definition.label}
                value={formatMetricValue(metric, fmt)}
                tone={metricTone(metric)}
                note={
                  <>
                    {metric.note ? <span>{metric.note}</span> : null}
                    <span className={styles.badgeRow}>
                      <ProvenanceBadge facets={metric.provenance} t={t} />
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
                label={t("commandCenter.forecastTitle")}
                note={t("commandCenter.forecastNote")}
                action={<ProvenanceLink href={provHref(basePath, forecast.provenanceId)} />}
              />
              <PanelBody>
                {/*
                  One sentence per outcome rather than a sentence assembled from fragments: word
                  order differs between the two languages, and a phrase glued together in the
                  middle of a clause reads as a translation in at least one of them.
                */}
                <p
                  className={`${styles.statement} ${forecast.delayDays > 0 ? styles.late : ""}`}
                  data-forecast-delay={forecast.delayDays}
                >
                  {forecast.delayDays === 0
                    ? t("commandCenter.forecastStatementOnTime", { days: forecast.windowDays })
                    : t(
                        forecast.delayDays > 0
                          ? "commandCenter.forecastStatementLate"
                          : "commandCenter.forecastStatementEarly",
                        {
                          days: forecast.windowDays,
                          delay: dayCount(
                            t,
                            forecast.delayDays,
                            fmt.count(Math.abs(forecast.delayDays)),
                          ),
                        },
                      )}
                </p>
                <div className={styles.forecastGrid}>
                  <div className={styles.forecastCells}>
                    <ForecastCell
                      label={t("commandCenter.currentRate")}
                      value={fmt.decimal(forecast.movingAveragePerDay)}
                      unit={t("commandCenter.perDay")}
                    />
                    <ForecastCell
                      label={t("commandCenter.requiredRate")}
                      value={
                        forecast.requiredRatePerDay === null
                          ? t("common.missing")
                          : fmt.decimal(forecast.requiredRatePerDay)
                      }
                      unit={t("commandCenter.perDay")}
                      highlight
                    />
                    <ForecastCell
                      label={t("commandCenter.activeTechnicians")}
                      value={fmt.count(forecast.activeTechnicians)}
                      unit={t("commandCenter.ofAssigned", {
                        count: fmt.count(forecast.assignedTechnicians),
                      })}
                    />
                    <ForecastCell
                      label={t("commandCenter.pending")}
                      value={fmt.count(forecast.pending)}
                      unit={t("commandCenter.parcelsUnit")}
                    />
                  </div>
                  <div className={styles.forecastChart}>
                    <span className={styles.chartLabel}>
                      {t("commandCenter.completionsPerDay", {
                        days: forecast.dailyCompletions.length,
                      })}
                    </span>
                    <ForecastChart
                      values={forecast.dailyCompletions}
                      highlightLast={forecast.windowDays}
                      startLabel={fmt.isoDateShort(
                        shiftDate(forecast.calculatedAt, -(forecast.dailyCompletions.length - 1)),
                      )}
                      endLabel={fmt.isoDateShort(forecast.calculatedAt.toISOString().slice(0, 10))}
                      label={t("commandCenter.completionsPerDayLabel", {
                        days: forecast.dailyCompletions.length,
                      })}
                    />
                    <p className={styles.assumptions}>
                      <span className={styles.assumptionsLabel}>
                        {t("commandCenter.assumptions")}
                      </span>{" "}
                      {forecast.assumptions.join(" · ")}
                    </p>
                    {/*
                      Traceability, in a sentence rather than as a bare token. The exact version
                      string stays where a reader can check it — the provenance record of the
                      forecast — and here it is introduced.
                    */}
                    <p className={styles.algorithm}>
                      {t("commandCenter.algorithmVersion")} <Mono>{forecast.algorithmVersion}</Mono>
                    </p>
                  </div>
                </div>
              </PanelBody>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader
              label={t("commandCenter.attentionTitle")}
              action={
                <span className={styles.count}>
                  {t("commandCenter.attentionCount", { count: fmt.count(view.attention.length) })}
                </span>
              }
            />
            {view.attention.length === 0 ? (
              <PanelBody>
                <p className={styles.muted}>{t("commandCenter.attentionEmpty")}</p>
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
                      severityLabel={attentionSeverityLabel(t, item.severity)}
                      title={item.title}
                      note={item.note}
                      surfaceLabel={
                        item.surface ? surfaceLabel(t, item.surface) : item.surfaceLabel
                      }
                      action={
                        href ? (
                          <ProvenanceLink href={href}>
                            {item.actionLabel ?? t("common.open")}
                          </ProvenanceLink>
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
                label={t("commandCenter.activityTitle")}
                badge={<DemoBadge facets={view.activity.map((a) => a.provenance)} t={t} />}
                note={scenarioLabel ?? undefined}
              />
              <ActivityTable
                caption={t("commandCenter.activityCaption")}
                headers={{
                  time: t("commandCenter.activityTime"),
                  actor: t("commandCenter.activityActor"),
                  action: t("commandCenter.activityAction"),
                  object: t("commandCenter.activityObject"),
                }}
                rows={view.activity.map((event) => ({
                  id: event.id,
                  time: fmt.time(event.occurredAt),
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
              <PanelHeader
                label={t("commandCenter.consultationTitle")}
                badge={<Chip tone="ok">{t("commandCenter.consultationComplete")}</Chip>}
              />
              <PanelBody>
                <div className={styles.bigFigure}>
                  <span className={styles.bigValue}>{formatMetricValue(consultation, fmt)}</span>
                  <span className={styles.bigNote}>{consultation.note}</span>
                </div>
                <div className={styles.badgeRow}>
                  <ProvenanceBadge facets={consultation.provenance} t={t} />
                  <ProvenanceLink href={provHref(basePath, consultation.provenanceId)} />
                </div>
              </PanelBody>
            </Panel>
          ) : null}

          {territory ? (
            <TerritorySummaryPanel
              basePath={basePath}
              gisPath={gisPath}
              i18n={i18n}
              territory={territory}
            />
          ) : null}

          {fieldProgress ? (
            <FieldProgressPanel
              basePath={basePath}
              fieldPath={fieldPath}
              i18n={i18n}
              progress={fieldProgress}
            />
          ) : null}

          <Panel>
            <PanelHeader label={t("commandCenter.scopeTitle")} />
            <PanelBody>
              <p className={styles.muted}>{t("commandCenter.scopeBody")}</p>
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
  i18n: { t, fmt },
}: {
  territory: TerritorialSummary;
  basePath: string;
  gisPath: string | null;
  i18n: I18n;
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
        label={t("commandCenter.territoryTitle")}
        badge={layer ? <ProvenanceBadge facets={layer.provenance} t={t} /> : undefined}
        action={
          gisPath ? (
            <ProvenanceLink href={gisPath}>{t("commandCenter.openGis")}</ProvenanceLink>
          ) : undefined
        }
      />
      <PanelBody>
        <div className={styles.territoryHead}>
          <span className={styles.bigValue}>{fmt.count(territory.parcelCount)}</span>
          <span className={styles.bigNote}>
            {t("commandCenter.parcelsInCorridor")}
            {territory.alignmentLengthM === null
              ? ""
              : t("commandCenter.alignmentLength", {
                  km: fmt.decimal(territory.alignmentLengthM / 1000, 1),
                })}
          </span>
        </div>
        <ul className={styles.territoryList}>
          {statuses.map((status) => (
            <li className={styles.territoryRow} key={status}>
              <span aria-hidden="true" className={styles.territoryGlyph}>
                {PARCEL_STATUS_PRESENTATION[status].glyph}
              </span>
              <span>{parcelStatusLabel(t, status)}</span>
              <Mono>{fmt.count(territory.byStatus[status])}</Mono>
            </li>
          ))}
          <li className={styles.territoryRow}>
            <span aria-hidden="true" className={styles.territoryGlyph} />
            <span>{t("commandCenter.mappedArea")}</span>
            <Mono>{fmt.decimal(territory.totalAreaM2 / 10_000, 1)} ha</Mono>
          </li>
          <li className={styles.territoryRow}>
            <span aria-hidden="true" className={styles.territoryGlyph} />
            <span>{t("commandCenter.affectedArea")}</span>
            <Mono>{fmt.decimal(territory.affectedAreaM2 / 10_000, 1)} ha</Mono>
          </li>
        </ul>
        {territory.withoutGeometry > 0 ? (
          <p className={styles.muted} data-system-state="partial gis">
            {t("commandCenter.withoutGeometry", {
              without: fmt.count(territory.withoutGeometry),
              total: fmt.count(territory.parcelCount),
            })}
          </p>
        ) : null}
        {layer ? (
          <p className={styles.muted}>
            {layerLegendLabel(t, layer.legend)} · {layerLegendNote(t, layer.legend)}{" "}
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
  i18n: { t, fmt },
}: {
  progress: FieldProgressSummary;
  basePath: string;
  fieldPath: string | null;
  i18n: I18n;
}) {
  return (
    <Panel>
      <PanelHeader
        label={t("commandCenter.fieldCampaignTitle")}
        badge={<ProvenanceBadge facets={progress.provenance} t={t} />}
        action={
          fieldPath ? (
            <ProvenanceLink href={fieldPath}>{t("commandCenter.openField")}</ProvenanceLink>
          ) : undefined
        }
      />
      <PanelBody>
        <div className={styles.territoryHead}>
          <span className={styles.bigValue}>
            {fmt.count(progress.submittedCount)} / {fmt.count(progress.progress.total)}
          </span>
          <span className={styles.bigNote}>
            {t("commandCenter.formsSubmitted", { campaign: progress.campaignName })}
          </span>
        </div>
        <ul className={styles.territoryList}>
          <li className={styles.territoryRow}>
            <span aria-hidden="true" className={styles.territoryGlyph} />
            <span>{t("commandCenter.assignments")}</span>
            <Mono>{fmt.count(progress.progress.total)}</Mono>
          </li>
          <li className={styles.territoryRow}>
            <span aria-hidden="true" className={styles.territoryGlyph} />
            <span>{t("commandCenter.pending")}</span>
            <Mono>{fmt.count(progress.progress.pending)}</Mono>
          </li>
          <li className={styles.territoryRow}>
            <span aria-hidden="true" className={styles.territoryGlyph} />
            <span>{t("commandCenter.completed")}</span>
            <Mono>{fmt.count(progress.progress.completed)}</Mono>
          </li>
        </ul>
        <p className={styles.muted}>
          {t("commandCenter.fieldCampaignNote")}{" "}
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
