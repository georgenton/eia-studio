"use client";

import { MIN_REVIEW_JUSTIFICATION } from "@eia/domain";
import { useId, useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { reviewDecisionWord } from "@/lib/labels";
import { decideCandidateAction } from "@/lib/document-review-actions";

import styles from "./documents.module.css";

/**
 * Accepting or dismissing one candidate.
 *
 * The justification is required in the markup and required again in the domain, and it is kept
 * whichever way the decision goes: a dismissal that left no record would let a study quietly lose
 * the fact that somebody looked at a suggestion and decided it was nothing.
 *
 * **Accept is not offered for a single-source candidate.** The server refuses it too — that is the
 * guarantee — but offering a button that always fails would teach a reader that the product is
 * broken rather than that the candidate has not shown a disagreement, so the reason is on screen
 * instead.
 */
export function CandidateDecision({
  tenant,
  project,
  candidateId,
  state,
  support,
}: {
  tenant: string;
  project: string;
  candidateId: string;
  state: string;
  support: string;
}) {
  const { t } = useI18n();
  const fieldId = useId();
  const decided = state !== "PROPOSED";
  const [decision, setDecision] = useState<string>(
    decided ? "REOPEN" : support === "TWO_SIDED" ? "ACCEPT" : "DISMISS",
  );
  const [justification, setJustification] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options = decided
    ? ["REOPEN"]
    : support === "TWO_SIDED"
      ? ["ACCEPT", "DISMISS"]
      : ["DISMISS"];

  const submit = () => {
    setError(null);
    if (justification.trim().length < MIN_REVIEW_JUSTIFICATION) {
      setError(t("documents.review.justificationTooShort"));
      return;
    }
    startTransition(async () => {
      const result = await decideCandidateAction({
        tenant,
        project,
        candidateId,
        decision,
        justification,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setJustification("");
    });
  };

  return (
    <div className={styles.decisionForm}>
      {support === "SINGLE_SOURCE" && !decided ? (
        <p className={styles.note}>{t("documents.review.acceptRefusedSingleSource")}</p>
      ) : null}
      <div className={styles.decisionRow}>
        <label className="sr-only" htmlFor={`${fieldId}-decision`}>
          {t("documents.review.decide")}
        </label>
        <select
          className={styles.select}
          id={`${fieldId}-decision`}
          onChange={(event) => setDecision(event.target.value)}
          value={decision}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {reviewDecisionWord(t, option)}
            </option>
          ))}
        </select>
        <button className={styles.primary} disabled={pending} onClick={submit} type="button">
          {t("documents.review.submitDecision")}
        </button>
      </div>
      <label className={styles.uploadField} htmlFor={`${fieldId}-justification`}>
        {t("documents.review.justification")}
        <textarea
          className={styles.textarea}
          id={`${fieldId}-justification`}
          onChange={(event) => setJustification(event.target.value)}
          value={justification}
        />
        <span className={styles.uploadHelp}>{t("documents.review.justificationHelp")}</span>
      </label>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
