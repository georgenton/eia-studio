import type { FieldOverview } from "@eia/application";
import { captureChannel, type FieldOfflineMode } from "@eia/domain";
import { Chip, Panel, PanelBody, PanelHeader, ProgressBar, ProvenanceBadge } from "@eia/ui";

import { ProvenanceLink } from "@/components/navigation";
import { campaignStatusLabel, captureChannelLabel, offlineModeLabel } from "@/lib/labels";
import type { I18n } from "@/lib/locale";

import styles from "./field-overview.module.css";

/** One operation, as a panel. The same shape whether it is the current one or history. */
function CampaignPanel({
  campaign,
  basePath,
  offlineMode,
  i18n: { t, fmt },
}: {
  campaign: FieldOverview["campaigns"][number];
  basePath: string;
  offlineMode: FieldOfflineMode;
  i18n: I18n;
}) {
  const channel = captureChannel(campaign.captureChannel);
  const mode = campaign.offlineModeAtActivation ?? offlineMode;
  return (
    <Panel>
      <PanelHeader
        /*
         * Which operation this is, in a word (ADR-026). A project keeps the campaigns that
         * ran; only one of them is what "pendientes" means today, and a reader should not
         * have to compare dates to work out which.
         */
        label={t(campaign.isCurrent ? "field.currentOperation" : "field.previousOperation")}
        badge={<ProvenanceBadge facets={campaign.provenance} t={t} />}
        action={
          <ProvenanceLink href={`${basePath}?prov=${campaign.provenanceId}`}>
            {t("field.viewProvenance")}
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
              {campaign.startsOn
                ? t("field.fromDate", { date: fmt.isoDate(campaign.startsOn) })
                : ""}
              {campaign.targetOn
                ? t("field.targetDate", { date: fmt.isoDate(campaign.targetOn) })
                : ""}
            </p>
          </div>
          <Chip tone={campaign.status === "ACTIVE" ? "ok" : "neutral"}>
            {campaignStatusLabel(t, campaign.status)}
          </Chip>
        </div>

        {campaign.isCurrent ? null : (
          <p className={styles.historyNote}>{t("field.closedOperationNote")}</p>
        )}

        <dl className={styles.channel}>
          <div>
            <dt>{t("field.captureChannel")}</dt>
            <dd>{captureChannelLabel(t, channel.key)}</dd>
          </div>
          <div>
            <dt>{t("field.offlineCapture")}</dt>
            {/* Stated as it is. Saying "offline disponible" for a channel that posts to the
                      server would cost a technician a day of work in a valley with no signal. */}
            <dd>
              {offlineModeLabel(t, mode)}
              <span className={styles.channelNote}>
                {t(
                  channel.supportsOffline
                    ? "field.channelSupportsOffline"
                    : "field.channelOnlineOnly",
                )}
              </span>
            </dd>
          </div>
        </dl>

        <div className={styles.progress}>
          <ProgressBar
            ratio={campaign.progress.completionRatio ?? 0}
            label={t("field.campaignProgress")}
            valueLabel={`${t("field.submittedOf", {
              submitted: fmt.count(campaign.submittedCount),
              total: fmt.count(campaign.progress.total),
            })}${
              campaign.progress.completionRatio === null
                ? ""
                : ` · ${fmt.percent(campaign.progress.completionRatio)}`
            }`}
          />
          <ul className={styles.counts}>
            <li>
              <span>{t("field.assigned")}</span>
              <strong>{fmt.count(campaign.progress.total)}</strong>
            </li>
            <li>
              <span>{t("field.pending")}</span>
              <strong>{fmt.count(campaign.progress.pending)}</strong>
            </li>
            <li>
              <span>{t("field.inProgress")}</span>
              <strong>{fmt.count(campaign.progress.inProgress)}</strong>
            </li>
            <li>
              <span>{t("field.completed")}</span>
              <strong>{fmt.count(campaign.progress.completed)}</strong>
            </li>
            <li>
              <span>{t("field.submitted")}</span>
              <strong>{fmt.count(campaign.submittedCount)}</strong>
            </li>
          </ul>
        </div>
      </PanelBody>
    </Panel>
  );
}

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
  i18n,
}: {
  overview: FieldOverview;
  basePath: string;
  offlineMode: FieldOfflineMode;
  i18n: I18n;
}) {
  const { t, fmt } = i18n;
  if (overview.campaigns.length === 0) {
    return (
      <div className={styles.empty} data-system-state="empty">
        <h1 className={styles.emptyTitle}>{t("field.noCampaignsTitle")}</h1>
        <p className={styles.emptyNote}>{t("field.noCampaignsBody")}</p>
      </div>
    );
  }

  const current = overview.campaigns.filter((campaign) => campaign.isCurrent);
  const history = overview.campaigns.filter((campaign) => !campaign.isCurrent);

  return (
    <div className={styles.surface}>
      {current.map((campaign) => (
        <CampaignPanel
          key={campaign.id}
          campaign={campaign}
          basePath={basePath}
          i18n={i18n}
          offlineMode={offlineMode}
        />
      ))}

      {history.length > 0 ? (
        /*
         * History is reachable, not in the way (ADR-026).
         *
         * A project accumulates operations, and a coordinator opening this surface is looking at
         * the one running now. Stacking a closed operation of equal weight underneath it invites
         * exactly the mistake this whole rule exists to prevent — reading yesterday's numbers as
         * today's. It opens on a click, and it is closed by default.
         */
        <details className={styles.history}>
          <summary className={styles.historySummary}>
            {history.length === 1
              ? t("field.showPreviousOne")
              : t("field.showPreviousMany", { count: fmt.count(history.length) })}
          </summary>
          <p className={styles.historyNote}>{t("field.closedOperationsNote")}</p>
          {history.map((campaign) => (
            <CampaignPanel
              key={campaign.id}
              campaign={campaign}
              basePath={basePath}
              i18n={i18n}
              offlineMode={offlineMode}
            />
          ))}
        </details>
      ) : null}

      <Panel>
        <PanelHeader label={t("field.workloadTitle")} />
        <PanelBody>
          {overview.workload.length === 0 ? (
            <p className={styles.emptyNote}>{t("field.noAssignments")}</p>
          ) : (
            <table className={styles.workload}>
              <caption className={styles.srOnly}>{t("field.workloadCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("field.technician")}</th>
                  <th scope="col">{t("field.pending")}</th>
                  <th scope="col">{t("field.inProgress")}</th>
                  <th scope="col">{t("field.completed")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.workload.map((row) => (
                  <tr key={row.userId}>
                    <td>{row.displayName}</td>
                    <td className={styles.numeric}>{fmt.count(row.pending)}</td>
                    <td className={styles.numeric}>{fmt.count(row.inProgress)}</td>
                    <td className={styles.numeric}>{fmt.count(row.completed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={styles.footnote}>{t("field.workloadFootnote")}</p>
        </PanelBody>
      </Panel>
    </div>
  );
}
