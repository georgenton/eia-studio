"use client";

import type { QualityOverview } from "@eia/application";
import type { MessageKey } from "@eia/i18n";
import { Chip, Panel, PanelBody, PanelHeader, StatusChip, type ChipTone } from "@eia/ui";
import Link from "next/link";
import { useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { runQualityCheckAction } from "@/lib/quality-actions";

import styles from "./quality.module.css";

/**
 * The Quality Gate's list.
 *
 * Two things it is careful about.
 *
 * **It shows what was checked, not only what was found.** A gate that lists nothing looks
 * identical whether it ran and found nothing or never ran at all, so the rule catalogue and the
 * last run's timestamp are on the page beside the findings.
 *
 * **Colour never carries the meaning alone.** Severity and state are words first; the chip's tone
 * is a second channel (design v0.2, accessibility baseline).
 */
const SEVERITY_TONE: Record<string, ChipTone> = { high: "crit", medium: "warn", low: "neutral" };

const STATE_TONE: Record<string, ChipTone> = {
  OPEN: "warn",
  UNDER_REVIEW: "accent",
  ACCEPTED: "crit",
  DISMISSED: "neutral",
  RESOLVED: "ok",
};

export function QualityOverviewPanel({
  overview,
  tenant,
  project,
  canRun,
}: {
  overview: QualityOverview;
  tenant: string;
  project: string;
  canRun: boolean;
}) {
  const { t, fmt } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await runQualityCheckAction({ tenant, project });
      setFailed(!result.ok);
      setMessage(result.ok ? (result.message ?? t("quality.runDone")) : result.error);
    });
  };

  return (
    <>
      <Panel>
        <PanelHeader
          label={t("quality.title")}
          note={
            overview.lastRun?.finishedAt
              ? t("quality.lastRun", {
                  when: fmt.dateTime(new Date(overview.lastRun.finishedAt)),
                })
              : t("quality.neverRun")
          }
          action={
            canRun ? (
              <button className={styles.primary} type="button" onClick={run} disabled={pending}>
                {pending ? t("quality.running") : t("quality.run")}
              </button>
            ) : null
          }
        />
        <PanelBody>
          <p className={styles.note}>{t("quality.lead")}</p>
          <dl className={styles.kpis}>
            <Kpi label={t("quality.open")} value={fmt.count(overview.counts.open)} />
            <Kpi label={t("quality.underReview")} value={fmt.count(overview.counts.underReview)} />
            <Kpi label={t("quality.highSeverity")} value={fmt.count(overview.counts.high)} />
            <Kpi label={t("quality.accepted")} value={fmt.count(overview.counts.accepted)} />
            <Kpi label={t("quality.resolved")} value={fmt.count(overview.counts.resolved)} />
            <Kpi label={t("quality.dismissed")} value={fmt.count(overview.counts.dismissed)} />
          </dl>
          {message ? (
            <p
              className={`${styles.feedback} ${failed ? styles.bad : styles.ok}`}
              role="status"
              aria-live="polite"
            >
              {message}
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          label={t("quality.findings")}
          note={t("quality.findingsCount", { count: fmt.count(overview.findings.length) })}
        />
        <PanelBody>
          {overview.findings.length === 0 ? (
            <p className={styles.note} data-system-state="no-findings">
              {t(overview.lastRun ? "quality.noFindingsAfterRun" : "quality.neverRunOnProject")}
            </p>
          ) : (
            <table className={styles.table}>
              <caption className="sr-only">{t("quality.findingsCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("quality.findingCode")}</th>
                  <th scope="col">{t("quality.finding")}</th>
                  <th scope="col">{t("quality.type")}</th>
                  <th scope="col">{t("quality.severity")}</th>
                  <th scope="col">{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.findings.map((finding) => (
                  <tr key={finding.id}>
                    <td className={styles.code}>
                      <Link
                        className={styles.findingLink}
                        href={`/t/${tenant}/p/${project}/quality/${finding.code}`}
                      >
                        {finding.code}
                      </Link>
                    </td>
                    <td>
                      {finding.title}
                      {finding.interdisciplinary ? (
                        <>
                          {" "}
                          <Chip tone="accent">{t("quality.interdisciplinary")}</Chip>
                        </>
                      ) : null}
                    </td>
                    <td>{t(`quality.findingType.${finding.type}` as MessageKey)}</td>
                    <td>
                      <Chip tone={SEVERITY_TONE[finding.severity] ?? "neutral"}>
                        {t(`quality.severityLabel.${finding.severity}` as MessageKey)}
                      </Chip>
                    </td>
                    <td>
                      <StatusChip
                        label={t(`quality.state.${finding.state}` as MessageKey)}
                        tone={STATE_TONE[finding.state] ?? "neutral"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label={t("quality.rulesTitle")} note={t("quality.rulesNote")} />
        <PanelBody>
          <ul className={styles.ruleList}>
            {overview.requirements.map((requirement) => (
              <li className={styles.ruleItem} key={requirement.key}>
                {/*
                  The rule's name, and its version as a plain word. The catalogue key is what a
                  finding stores so a decision taken last month can be traced to the exact rule
                  that produced it — it belongs in the finding's detail, not in a list a specialist
                  reads to know what was checked.
                */}
                <span className={styles.ruleName}>
                  {t(
                    `vocabulary.requirement.${requirement.key.replace(/\./g, "_")}.title` as MessageKey,
                  )}{" "}
                  <span className={styles.code}>
                    {t("quality.ruleVersion", { version: requirement.version })}
                  </span>
                </span>
                <span className={styles.ruleWhat}>
                  {t(
                    `vocabulary.requirement.${requirement.key.replace(/\./g, "_")}.what` as MessageKey,
                  )}
                </span>
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.kpi}>
      <dt className={styles.kpiLabel}>{label}</dt>
      <dd className={styles.kpiValue}>{value}</dd>
    </div>
  );
}
