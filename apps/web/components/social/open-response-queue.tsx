"use client";

import type { OpenResponseRow, TaxonomyVersionSummary } from "@eia/application";
import type { MessageKey, Translator } from "@eia/i18n";
import { Chip, Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useMemo, useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { reviewDecisionLabel } from "@/lib/labels";
import { submitReviewAction } from "@/lib/social-actions";

import styles from "./social.module.css";

/**
 * The open-response queue and the review workspace.
 *
 * Three separate things are on screen at once and the layout has to keep them distinguishable: the
 * words a person said, what a model proposed about them, and what the specialist decided. The
 * proposal is always labelled *provisional*, the decision is always labelled with who made it, and
 * neither is ever rendered in the other's place.
 *
 * The model's confidence appears as a labelled chip with its help text attached, never as a bare
 * percentage: an uncalibrated heuristic printed as "86 %" beside a category reads exactly like an
 * accuracy, which is the one thing it is not.
 *
 * A row carries the response, its question and its version. No respondent, no technician, no
 * parcel, no coordinate: this screen stays open all day on a specialist's desk, and none of that
 * is needed to code what was said.
 */
type Filter = "all" | "pending-ai" | "failed" | "pending-review" | "reviewed" | "low-confidence";

const FILTER_KEY: Readonly<Record<Filter, MessageKey>> = {
  all: "social.filterAll",
  "pending-ai": "social.filterPendingAi",
  failed: "social.filterFailed",
  "pending-review": "social.filterPendingReview",
  reviewed: "social.filterReviewed",
  "low-confidence": "social.filterLowConfidence",
};

export function OpenResponseQueue({
  responses,
  taxonomy,
  tenant,
  project,
}: {
  responses: ReadonlyArray<OpenResponseRow>;
  taxonomy: TaxonomyVersionSummary | null;
  tenant: string;
  project: string;
}) {
  const { t, fmt } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(
    () => responses.filter((row) => matches(row, filter)),
    [responses, filter],
  );

  if (responses.length === 0) {
    return (
      <Panel>
        <PanelHeader label={t("social.openAnswers")} />
        <PanelBody>
          <p className={styles.note} data-system-state="no-survey-data">
            {t("social.noOpenAnswers")}
          </p>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        label={t("social.openAnswers")}
        action={
          <span className={styles.deterministic}>
            {t("social.inView", { count: fmt.count(filtered.length) })}
          </span>
        }
      />
      <PanelBody>
        <div className={styles.filters} role="group" aria-label={t("social.filterResponses")}>
          {(Object.keys(FILTER_KEY) as Filter[]).map((key) => (
            <button
              key={key}
              type="button"
              className={styles.filter}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {t(FILTER_KEY[key])}
            </button>
          ))}
        </div>

        <ul className={styles.queue}>
          {filtered.map((row) => (
            <li key={row.answerId} className={styles.row}>
              <article>
                <p className={styles.responseText}>{row.text}</p>
                <p className={styles.rowMeta}>
                  {t("social.rowMeta", {
                    question: row.questionPrompt,
                    version: row.surveyVersionLabel,
                  })}
                </p>

                <div className={styles.rowChips}>
                  <StatusChip row={row} t={t} />
                  {row.confidence !== null ? (
                    <span
                      className={styles.confidence}
                      data-band={row.confidenceBand}
                      title={t("social.confidenceHelp")}
                    >
                      {t("social.confidenceLabel")}: {fmt.percent(row.confidence)}
                      {row.confidenceBand === "low" ? t("social.reviewFirst") : ""}
                    </span>
                  ) : null}
                  {row.needsReview ? (
                    <Chip tone="warn">{t("social.modelAskedForReview")}</Chip>
                  ) : null}
                </div>

                {row.proposed.length > 0 ? (
                  <div className={styles.proposalBlock}>
                    <p className={styles.proposalLabel}>{t("social.proposalLabel")}</p>
                    <ul className={styles.chipList}>
                      {row.proposed.map((category) => (
                        <li key={category.code} className={styles.provisionalChip}>
                          {category.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {row.reviewId ? (
                  <div className={styles.validatedBlock}>
                    <p className={styles.validatedLabel}>
                      {t("social.validatedLabel", {
                        decision: reviewDecisionLabel(t, row.reviewDecision ?? "ACCEPTED"),
                      })}
                    </p>
                    <ul className={styles.chipList}>
                      {row.finalCategories.map((category) => (
                        <li key={category.code} className={styles.validatedChip}>
                          {category.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {row.error ? <p className={styles.error}>{row.error}</p> : null}

                {row.classificationStatus === "SUCCEEDED" && !row.reviewId && taxonomy ? (
                  <button
                    type="button"
                    className={styles.reviewButton}
                    onClick={() => setOpenId(openId === row.answerId ? null : row.answerId)}
                    aria-expanded={openId === row.answerId}
                  >
                    {openId === row.answerId
                      ? t("social.closeReview")
                      : t("social.reviewAndDecide")}
                  </button>
                ) : null}

                {openId === row.answerId && taxonomy && row.classificationId ? (
                  <ReviewWorkspace
                    row={row}
                    taxonomy={taxonomy}
                    tenant={tenant}
                    project={project}
                    onDone={() => setOpenId(null)}
                  />
                ) : null}
              </article>
            </li>
          ))}
        </ul>

        {/* Both semantic notes are rendered as text, not only as tooltips. A claim this easy to
            misread — an uncalibrated heuristic printed beside a category — has to be legible to a
            screen reader and to someone who never hovers. */}
        <p className={styles.agreementNote}>
          <strong>{t("social.confidenceLabel")}.</strong> {t("social.confidenceHelp")}
        </p>
        <p className={styles.agreementNote}>
          <strong>{t("social.agreementLabel")}.</strong> {t("social.agreementHelp")}
        </p>
      </PanelBody>
    </Panel>
  );
}

function StatusChip({ row, t }: { row: OpenResponseRow; t: Translator }) {
  if (row.reviewId) return <Chip tone="ok">{t("social.statusValidated")}</Chip>;
  if (row.classificationStatus === "SUCCEEDED")
    return <Chip tone="neutral">{t("social.statusProposalReady")}</Chip>;
  if (row.classificationStatus === "FAILED")
    return <Chip tone="warn">{t("social.statusFailed")}</Chip>;
  if (row.classificationStatus === "PROCESSING")
    return <Chip tone="neutral">{t("social.statusProcessing")}</Chip>;
  if (row.classificationStatus === "PENDING")
    return <Chip tone="neutral">{t("social.statusQueued")}</Chip>;
  return <Chip tone="neutral">{t("social.statusNoProposal")}</Chip>;
}

/**
 * The review itself: the raw answer, the proposal, and the categories of the exact version the
 * proposal was made against.
 *
 * The specialist can add and remove categories and submit. They cannot edit the answer, and they
 * cannot change the taxonomy version — a coding is made against one definition, and a page that
 * let someone switch it mid-review would produce a coding whose meaning depends on when it was
 * opened.
 */
function ReviewWorkspace({
  row,
  taxonomy,
  tenant,
  project,
  onDone,
}: {
  row: OpenResponseRow;
  taxonomy: TaxonomyVersionSummary;
  tenant: string;
  project: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const proposedCodes = row.proposed.map((category) => category.code);
  const [selected, setSelected] = useState<ReadonlyArray<string>>(proposedCodes);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Elapsed operational time, measured server-side from this instant. Not active work time.
  const [openedAt] = useState(() => new Date().toISOString());

  const toggle = (code: string) => {
    setSelected((current) =>
      current.includes(code) ? current.filter((value) => value !== code) : [...current, code],
    );
  };

  const submit = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await submitReviewAction({
        tenant,
        project,
        classificationId: row.classificationId!,
        categoryCodes: [...selected],
        reviewStartedAt: openedAt,
      });
      if (result.ok) {
        setMessage(result.message ?? t("social.reviewRecorded"));
        onDone();
      } else {
        setMessage(result.error);
      }
    });
  };

  return (
    <div className={styles.review}>
      <p className={styles.reviewVersion}>
        {t("social.reviewScheme", {
          version: taxonomy.versionLabel,
          note: taxonomy.sourceNote ?? "",
        })}
      </p>

      <fieldset className={styles.categoryFieldset}>
        <legend className={styles.categoryLegend}>{t("social.categoriesOfVersion")}</legend>
        {taxonomy.categories.map((category) => {
          const checked = selected.includes(category.code);
          const wasProposed = proposedCodes.includes(category.code);
          return (
            <label key={category.code} className={styles.categoryOption}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(category.code)}
                disabled={pending}
              />
              <span>
                <span className={styles.categoryLabel}>
                  {category.label}
                  {wasProposed ? (
                    <span className={styles.proposedMark}>{t("social.proposedMark")}</span>
                  ) : null}
                </span>
                <span className={styles.categoryDescription}>{category.description}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className={styles.reviewActions}>
        <button
          type="button"
          className={styles.primary}
          onClick={submit}
          disabled={pending || selected.length === 0}
        >
          {sameSet(selected, proposedCodes)
            ? t("social.acceptProposal")
            : t("social.saveCorrection")}
        </button>
        <button type="button" className={styles.secondary} onClick={onDone} disabled={pending}>
          {t("common.cancel")}
        </button>
      </div>
      {selected.length === 0 ? (
        <p className={styles.error}>{t("social.atLeastOneCategory")}</p>
      ) : null}
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );
}

function sameSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return b.every((value) => left.has(value));
}

function matches(row: OpenResponseRow, filter: Filter): boolean {
  switch (filter) {
    case "pending-ai":
      return row.classificationStatus === null || row.classificationStatus === "PENDING";
    case "failed":
      return row.classificationStatus === "FAILED";
    case "pending-review":
      return row.classificationStatus === "SUCCEEDED" && row.reviewId === null;
    case "reviewed":
      return row.reviewId !== null;
    case "low-confidence":
      return row.confidenceBand === "low";
    default:
      return true;
  }
}
