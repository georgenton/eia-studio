"use client";

import type { ReportOverview } from "@eia/application";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import Link from "next/link";
import { useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { generateChapterAction } from "@/lib/report-actions";

import styles from "./reports.module.css";

/**
 * The chapter's versions.
 *
 * A version is the unit, and every one of them stays: regenerating produces a new one, and the
 * previous keeps exactly what it said. The list is the chapter's history, not a stack of drafts to
 * clean up.
 */
export function ReportOverviewPanel({
  overview,
  tenant,
  project,
  canGenerate,
}: {
  overview: ReportOverview;
  tenant: string;
  project: string;
  canGenerate: boolean;
}) {
  const { t, fmt } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const generate = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await generateChapterAction({ tenant, project });
      setFailed(!result.ok);
      setMessage(result.ok ? result.message : result.error);
    });
  };

  return (
    <Panel>
      <PanelHeader
        label={overview.title}
        note={
          overview.versions.length === 0
            ? t("reports.noVersions")
            : t("reports.versionsCount", { count: fmt.count(overview.versions.length) })
        }
        action={
          canGenerate ? (
            <button className={styles.primary} type="button" onClick={generate} disabled={pending}>
              {pending ? t("reports.generating") : t("reports.generate")}
            </button>
          ) : null
        }
      />
      <PanelBody>
        <p className={styles.draftBanner}>{t("reports.draftBannerFull")}</p>
        <p className={styles.note}>{t("reports.immutableNote")}</p>

        {message ? (
          <p
            className={`${styles.feedback} ${failed ? styles.bad : styles.ok}`}
            role="status"
            aria-live="polite"
          >
            {message}
          </p>
        ) : null}

        {overview.versions.length > 0 ? (
          <table className={styles.table} style={{ marginTop: 12 }}>
            <caption className="sr-only">{t("reports.versionsCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("common.version")}</th>
                <th scope="col">{t("reports.generatedAt")}</th>
                <th scope="col">{t("reports.questionnaire")}</th>
                <th scope="col">{t("reports.figures")}</th>
                <th scope="col">{t("reports.narrative")}</th>
                <th scope="col">{t("reports.downloadColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {overview.versions.map((version) => (
                <tr key={version.id}>
                  <td className={styles.code}>
                    <Link
                      className={styles.versionLink}
                      href={`/t/${tenant}/p/${project}/reports/${version.versionLabel}`}
                    >
                      {version.versionLabel}
                    </Link>
                    {version.current ? t("reports.current") : ""}
                  </td>
                  <td>
                    {fmt.dateTime(new Date(version.generatedAt))}
                    {version.generatedBy ? (
                      <div className={styles.factSource}>{version.generatedBy}</div>
                    ) : null}
                  </td>
                  <td className={styles.code}>{version.surveyVersionLabel}</td>
                  <td>{fmt.count(version.factCount)}</td>
                  <td>{version.narrativeModel ?? t("reports.noNarrative")}</td>
                  <td>
                    <a
                      className={styles.download}
                      href={`/t/${tenant}/p/${project}/reports/${version.versionLabel}/docx`}
                    >
                      .docx
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
