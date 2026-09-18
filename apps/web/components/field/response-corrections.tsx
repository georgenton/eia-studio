"use client";

import type { CorrectionLineage } from "@eia/application";
import { Chip, Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { cancelCorrectionAction, requestCorrectionAction } from "@/lib/correction-actions";

import styles from "./corrections.module.css";

/**
 * The history of one response, and the way to ask for a new one (ADR-038).
 *
 * ## The word that is missing
 *
 * Nothing here says *edit* and nothing says *delete*, because neither happens. Every submission in
 * the list still exists, with its own technician and its own date; what a correction changes is
 * **which one the analysis currently means**, and the two chips say exactly that — *Vigente para
 * análisis* and *Sustituida*.
 *
 * A correction that has been asked for and not yet captured changes nothing at all, and the notice
 * says so, because the obvious wrong assumption is that requesting one has already removed the
 * figure from the counts.
 */
export function ResponseCorrections({
  lineage,
  instanceId,
  canRequest,
  tenant,
  project,
}: {
  lineage: CorrectionLineage | null;
  instanceId: string | null;
  canRequest: boolean;
  tenant: string;
  project: string;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  if (instanceId === null) return null;

  const open = lineage?.openCorrection ?? null;
  const entries = lineage?.entries ?? [];
  const showForm = canRequest && open === null && lineage?.effectiveInstanceId === instanceId;

  return (
    <Panel>
      <PanelHeader label={t("field.lineageTitle")} />
      <PanelBody>
        <p className={styles.note}>{t("field.lineageNote")}</p>

        {open ? (
          <div className={styles.pending}>
            <Chip tone="warn">{t("field.correctionRequested")}</Chip>
            <p className={styles.note}>{t("field.correctionPendingNotice")}</p>
            <p className={styles.reason}>{open.reason}</p>
            <p className={styles.meta}>
              {t("field.lineageRequestedBy", {
                name: open.requestedByName ?? t("field.lineageUnknownPerson"),
              })}
            </p>
            {canRequest ? (
              <button
                className={styles.linkish}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await cancelCorrectionAction({
                      tenant,
                      project,
                      correctionId: open.id,
                    });
                    setFailed(!result.ok);
                    setMessage(result.ok ? result.message : result.error);
                  })
                }
                type="button"
              >
                {t("field.correctionCancel")}
              </button>
            ) : null}
          </div>
        ) : null}

        {entries.length > 1 || open ? (
          <ol className={styles.lineage}>
            {entries.map((entry) => (
              <li className={styles.entry} key={entry.instanceId}>
                <span className={styles.entryLabel}>
                  {entry.generation === 0
                    ? t("field.lineageOriginal")
                    : t("field.lineageCorrection", { n: entry.generation })}
                </span>
                <Chip tone={entry.effective ? "ok" : "neutral"}>
                  {entry.effective ? t("field.lineageEffective") : t("field.lineageSuperseded")}
                </Chip>
                <span className={styles.meta}>
                  {t("field.lineageBy", {
                    name: entry.technicianName ?? t("field.lineageUnknownPerson"),
                  })}
                </span>
                {entry.correction ? (
                  <span className={styles.reason}>{entry.correction.reason}</span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}

        {showForm ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              start(async () => {
                const result = await requestCorrectionAction({
                  tenant,
                  project,
                  instanceId,
                  reason,
                });
                setFailed(!result.ok);
                setMessage(result.ok ? result.message : result.error);
                if (result.ok) setReason("");
              });
            }}
          >
            <div className={styles.field}>
              <label className={styles.field} htmlFor="correction-reason">
                <span className={styles.label}>{t("field.correctionReason")}</span>
              </label>
              <textarea
                className={styles.input}
                id="correction-reason"
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                value={reason}
              />
              {/* Outside the label: a hint inside one becomes part of the field's accessible name. */}
              <span className={styles.meta}>{t("field.correctionReasonHint")}</span>
            </div>
            <div className={styles.actions}>
              <button className={styles.primary} disabled={pending} type="submit">
                {pending ? t("field.correctionSubmitting") : t("field.requestCorrection")}
              </button>
            </div>
          </form>
        ) : null}

        {message ? (
          <p className={`${styles.feedback} ${failed ? styles.bad : styles.ok}`}>{message}</p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
