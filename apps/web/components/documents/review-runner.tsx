"use client";

import { REVIEW_LENSES } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useId, useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { documentPrivacyLabel, reviewBlockedReasonLabel, reviewLensLabel } from "@/lib/labels";
import { startDocumentReviewAction } from "@/lib/document-review-actions";

import styles from "./documents.module.css";

/**
 * Asking for an assisted review.
 *
 * One control, one lens, and the sentence that has to survive every redesign of this page: *a
 * model proposes; a person decides*. The copy never says the review found, detected or identified
 * anything, and `documents.review.distinction` says in as many words how this differs from the
 * Quality Gate — because the two live one click apart and a reader must never have to infer which
 * one produced a row (ADR-035 §4).
 *
 * A refused corpus renders **which documents blocked it**. "Not permitted" would send somebody
 * hunting; naming `DOC-004` lets them go and look at its classification.
 */
export interface ReviewableDocument {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly privacyClassification: string;
  readonly processingState: string;
  /** Whether a run including it could proceed at all. Shown, never silently applied. */
  readonly eligible: boolean;
}

export function ReviewRunner({
  tenant,
  project,
  documents,
}: {
  tenant: string;
  project: string;
  documents: ReadonlyArray<ReviewableDocument>;
}) {
  const { t } = useI18n();
  const fieldId = useId();
  const [lens, setLens] = useState<string>(REVIEW_LENSES[0].key);
  /*
   * The eligible documents start selected, and the others start unselected **and visible**, each
   * labelled with the classification that makes it ineligible. That is a default a person can
   * change, not a filter: checking an ineligible document is allowed, and the run is then refused
   * in full and says which document did it (ADR-035 §6).
   */
  const [selected, setSelected] = useState<ReadonlyArray<string>>(
    documents.filter((document) => document.eligible).map((document) => document.id),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ReadonlyArray<{ code: string; reason: string }>>([]);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setMessage(null);
    setError(null);
    setBlocked([]);
    startTransition(async () => {
      const result = await startDocumentReviewAction({
        tenant,
        project,
        lens,
        documentIds: [...selected],
      });
      if (!result.ok) {
        setError(result.error);
        setBlocked(result.blocked ?? []);
        return;
      }
      setMessage(t("documents.review.runStarted", { sources: String(result.sourceCount) }));
    });
  };

  return (
    <Panel>
      <PanelHeader label={t("documents.review.title")} note={t("documents.review.lead")} />
      <PanelBody>
        <p className={styles.note}>{t("documents.review.distinction")}</p>

        <label className={styles.uploadField} htmlFor={`${fieldId}-lens`}>
          {t("documents.review.lensLabel")}
          <select
            className={styles.select}
            id={`${fieldId}-lens`}
            onChange={(event) => setLens(event.target.value)}
            value={lens}
          >
            {REVIEW_LENSES.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {reviewLensLabel(t, entry.key)}
              </option>
            ))}
          </select>
          <span className={styles.uploadHelp}>{t("documents.review.lensHelp")}</span>
        </label>

        <fieldset className={styles.uploadFields}>
          <legend className={styles.uploadLegend}>{t("documents.review.corpusTitle")}</legend>
          {documents.length === 0 ? (
            <p className={styles.note}>{t("documents.noDocuments")}</p>
          ) : (
            documents.map((document) => (
              <label className={styles.uploadChoice} key={document.id}>
                <input
                  checked={selected.includes(document.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, document.id]
                        : current.filter((id) => id !== document.id),
                    )
                  }
                  type="checkbox"
                  value={document.id}
                />
                <span>
                  {document.code}
                  <span className={styles.uploadHelp}> · {document.title}</span>
                  {document.eligible ? null : (
                    <span className={styles.privacyFlag}>
                      {t("documents.privacy")}:{" "}
                      {documentPrivacyLabel(t, document.privacyClassification)}
                    </span>
                  )}
                </span>
              </label>
            ))
          )}
        </fieldset>
        <p className={styles.note}>{t("documents.review.corpusNote")}</p>

        <button
          className={styles.primary}
          disabled={pending || selected.length === 0}
          onClick={submit}
          type="button"
        >
          {pending ? t("documents.review.running") : t("documents.review.run")}
        </button>

        {message ? (
          <p className={styles.note} data-testid="review-started">
            {message}
          </p>
        ) : null}
        {error ? (
          <div data-testid="review-refused">
            <p className={styles.error}>{error}</p>
            {blocked.length > 0 ? (
              <ul className={styles.blockedList}>
                {blocked.map((item) => (
                  <li key={item.code}>
                    {t("documents.review.refusedDocument", {
                      code: item.code,
                      reason: reviewBlockedReasonLabel(t, item.reason),
                    })}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
