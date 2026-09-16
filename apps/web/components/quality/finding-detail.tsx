"use client";

import type { FindingDetail } from "@eia/application";
import type { MessageKey } from "@eia/i18n";
import { Chip, Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { decideFindingAction } from "@/lib/quality-actions";

import styles from "./quality.module.css";

/**
 * One finding: the two sources, side by side, and the decision block.
 *
 * The layout is the argument. Source A and Source B are the same size, in the same treatment,
 * quoted verbatim with their reference underneath — because the product's position is that it does
 * not know which one is right. A design that emphasised one side would be making the claim the
 * module refuses to make.
 *
 * Below them: why the rule looked, what a person might do about it, and the decision form. Every
 * decision needs a justification, and the history of decisions is on the page rather than behind a
 * toggle: who settled this and on what grounds is the record, not a detail.
 */
export function FindingDetailPanel({
  finding,
  tenant,
  project,
  canDecide,
}: {
  finding: FindingDetail;
  tenant: string;
  project: string;
  canDecide: boolean;
}) {
  const { t, fmt } = useI18n();
  const [decision, setDecision] = useState(finding.availableDecisions[0] ?? "");
  const [justification, setJustification] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await decideFindingAction({
        tenant,
        project,
        findingId: finding.id,
        decision,
        justification,
      });
      setFailed(!result.ok);
      setMessage(result.ok ? (result.message ?? t("quality.decisionRecorded")) : result.error);
      if (result.ok) setJustification("");
    });
  };

  const sources = finding.evidence.filter((item) => item.role !== "CONTEXT");
  const context = finding.evidence.filter((item) => item.role === "CONTEXT");

  return (
    <>
      <Panel>
        <PanelHeader
          label={`${finding.code} · ${finding.title}`}
          badge={<Chip tone="neutral">{t(`quality.state.${finding.state}` as MessageKey)}</Chip>}
          note={t("quality.detectedAt", {
            when: fmt.dateTime(new Date(finding.detectedAt)),
            rule: `${finding.requirementKey}@${finding.requirementVersion}`,
          })}
        />
        <PanelBody>
          <p className={styles.explain}>{finding.explanation}</p>
          {finding.interdisciplinary ? (
            <p className={styles.note}>
              <Chip tone="accent">{t("quality.interdisciplinary")}</Chip>{" "}
              {t("quality.interdisciplinaryNote")}
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label={t("quality.evidence")} note={t("quality.evidenceNote")} />
        <PanelBody>
          <div className={styles.sources}>
            {sources.map((item, index) => (
              <div className={styles.source} key={`${item.role}-${index}`}>
                <span className={styles.sourceRole}>
                  {t(`quality.evidenceRole.${item.role}` as MessageKey)}
                </span>
                <span className={styles.sourceLabel}>{item.label}</span>
                <blockquote className={styles.quote}>{item.quote}</blockquote>
                {item.documentRef ? (
                  <span className={styles.sourceRef}>
                    {t("quality.transcribedFrom")}{" "}
                    <a
                      className={styles.documentLink}
                      href={`/t/${tenant}/p/${project}/documents/${item.documentRef.code}${
                        item.documentRef.chunkOrdinal === null
                          ? ""
                          : `#p-${item.documentRef.chunkOrdinal}`
                      }`}
                    >
                      {item.documentRef.code} {item.documentRef.versionLabel}
                      {item.documentRef.page === null ? "" : ` · p. ${item.documentRef.page}`}
                    </a>{" "}
                    — {item.documentRef.title}.
                    {item.documentRef.chunkOrdinal === null ? t("quality.passageNotMatched") : ""}
                  </span>
                ) : (
                  <span className={styles.sourceRef}>
                    {t(
                      item.sourceRef ? "quality.reconstructedExtract" : "quality.declaredOnProject",
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
          {context.length > 0 ? (
            <ul className={styles.ruleList} style={{ marginTop: 12 }}>
              {context.map((item, index) => (
                <li className={styles.ruleItem} key={`ctx-${index}`}>
                  <span className={styles.ruleName}>{item.label}</span>
                  <span className={styles.ruleWhat}>{item.quote}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label={t("quality.whyFlagged")} />
        <PanelBody>
          <p className={styles.explain}>{finding.whyFlagged}</p>
          <p className={styles.note} style={{ marginTop: 10 }}>
            <strong>{t("quality.suggestedAction")}</strong> {finding.suggestedAction}
          </p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          label={t("quality.decisionTitle")}
          note={t(canDecide ? "quality.decisionNoteCanDecide" : "quality.decisionNoteReadOnly")}
        />
        <PanelBody>
          {canDecide && finding.availableDecisions.length > 0 ? (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="decision">
                  {t("quality.decision")}
                </label>
                <select
                  className={styles.select}
                  id="decision"
                  value={decision}
                  onChange={(event) => setDecision(event.target.value)}
                >
                  {finding.availableDecisions.map((option) => (
                    <option key={option} value={option}>
                      {t(`quality.decisionOption.${option}` as MessageKey)}
                    </option>
                  ))}
                </select>
                <span className={styles.sourceRef}>
                  {decision ? t(`quality.decisionHelp.${decision}` as MessageKey) : ""}
                </span>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="justification">
                  {t("quality.justification")}
                </label>
                <textarea
                  className={styles.textarea}
                  id="justification"
                  value={justification}
                  onChange={(event) => setJustification(event.target.value)}
                  placeholder={t("quality.justificationPlaceholder")}
                />
                <span className={styles.sourceRef}>{t("quality.justificationHint")}</span>
              </div>
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  type="button"
                  onClick={submit}
                  disabled={pending || justification.trim().length < 12}
                >
                  {pending ? t("quality.recording") : t("quality.recordDecision")}
                </button>
              </div>
            </>
          ) : (
            <p className={styles.note}>
              {t(canDecide ? "quality.noTransitions" : "quality.reviewerOnly")}
            </p>
          )}
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
          label={t("quality.historyTitle")}
          note={
            finding.reviews.length === 0
              ? t("quality.historyEmptyNote")
              : t("quality.historyCount", { count: fmt.count(finding.reviews.length) })
          }
        />
        <PanelBody>
          {finding.reviews.length === 0 ? (
            <p className={styles.note}>{t("quality.historyEmptyBody")}</p>
          ) : (
            <ol className={styles.history}>
              {finding.reviews.map((review, index) => (
                <li className={styles.historyItem} key={index}>
                  <span className={styles.historyHead}>
                    {t(`quality.decisionOption.${review.decision}` as MessageKey)} ·{" "}
                    {t(`quality.state.${review.fromState}` as MessageKey)} →{" "}
                    {t(`quality.state.${review.toState}` as MessageKey)}
                  </span>
                  <span className={styles.historyMeta}>
                    {review.reviewerName ?? t("quality.reviewer")} ·{" "}
                    {fmt.dateTime(new Date(review.reviewedAt))}
                  </span>
                  <p className={styles.historyText}>{review.justification}</p>
                </li>
              ))}
            </ol>
          )}
        </PanelBody>
      </Panel>
    </>
  );
}
