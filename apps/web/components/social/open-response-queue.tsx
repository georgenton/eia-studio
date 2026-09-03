"use client";

import type { OpenResponseRow, TaxonomyVersionSummary } from "@eia/application";
import { AGREEMENT_SEMANTICS, CONFIDENCE_SEMANTICS, REVIEW_DECISION_LABEL } from "@eia/domain";
import { Chip, formatCount, formatPercent, Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useMemo, useState, useTransition } from "react";

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

const FILTER_LABEL: Readonly<Record<Filter, string>> = {
  all: "Todas",
  "pending-ai": "Pendientes de IA",
  failed: "IA fallida",
  "pending-review": "Pendientes de revisión",
  reviewed: "Revisadas",
  "low-confidence": "Confianza baja",
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
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(
    () => responses.filter((row) => matches(row, filter)),
    [responses, filter],
  );

  if (responses.length === 0) {
    return (
      <Panel>
        <PanelHeader label="Respuestas abiertas" />
        <PanelBody>
          <p className={styles.note} data-system-state="no-survey-data">
            No hay respuestas abiertas enviadas en esta versión del cuestionario. La codificación
            asistida solo lee respuestas enviadas con texto.
          </p>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        label="Respuestas abiertas"
        action={
          <span className={styles.deterministic}>{formatCount(filtered.length)} en vista</span>
        }
      />
      <PanelBody>
        <div className={styles.filters} role="group" aria-label="Filtrar respuestas">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((key) => (
            <button
              key={key}
              type="button"
              className={styles.filter}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {FILTER_LABEL[key]}
            </button>
          ))}
        </div>

        <ul className={styles.queue}>
          {filtered.map((row) => (
            <li key={row.answerId} className={styles.row}>
              <article>
                <p className={styles.responseText}>{row.text}</p>
                <p className={styles.rowMeta}>
                  {row.questionPrompt} · versión {row.surveyVersionLabel}
                </p>

                <div className={styles.rowChips}>
                  <StatusChip row={row} />
                  {row.confidence !== null ? (
                    <span
                      className={styles.confidence}
                      data-band={row.confidenceBand}
                      title={CONFIDENCE_SEMANTICS.help}
                    >
                      {CONFIDENCE_SEMANTICS.label}: {formatPercent(row.confidence)}
                      {row.confidenceBand === "low" ? " · revisar primero" : ""}
                    </span>
                  ) : null}
                  {row.needsReview ? (
                    <Chip tone="warn">El modelo pidió revisión humana</Chip>
                  ) : null}
                </div>

                {row.proposed.length > 0 ? (
                  <div className={styles.proposalBlock}>
                    <p className={styles.proposalLabel}>
                      Propuesta de la IA · <strong>provisional, sin validar</strong>
                    </p>
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
                      Codificación validada por especialista ·{" "}
                      {REVIEW_DECISION_LABEL[row.reviewDecision ?? "ACCEPTED"]}
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
                    {openId === row.answerId ? "Cerrar revisión" : "Revisar y decidir"}
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
          <strong>{CONFIDENCE_SEMANTICS.label}.</strong> {CONFIDENCE_SEMANTICS.help}
        </p>
        <p className={styles.agreementNote}>
          <strong>{AGREEMENT_SEMANTICS.label}.</strong> {AGREEMENT_SEMANTICS.help}
        </p>
      </PanelBody>
    </Panel>
  );
}

function StatusChip({ row }: { row: OpenResponseRow }) {
  if (row.reviewId) return <Chip tone="ok">Validada</Chip>;
  if (row.classificationStatus === "SUCCEEDED") return <Chip tone="neutral">Propuesta lista</Chip>;
  if (row.classificationStatus === "FAILED") return <Chip tone="warn">Clasificación fallida</Chip>;
  if (row.classificationStatus === "PROCESSING") return <Chip tone="neutral">Procesando</Chip>;
  if (row.classificationStatus === "PENDING") return <Chip tone="neutral">En cola</Chip>;
  return <Chip tone="neutral">Sin propuesta</Chip>;
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
        setMessage(result.message ?? "Revisión registrada.");
        onDone();
      } else {
        setMessage(result.error);
      }
    });
  };

  return (
    <div className={styles.review}>
      <p className={styles.reviewVersion}>
        Esquema <strong>{taxonomy.versionLabel}</strong> · {taxonomy.sourceNote}
      </p>

      <fieldset className={styles.categoryFieldset}>
        <legend className={styles.categoryLegend}>Categorías de esta versión</legend>
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
                    <span className={styles.proposedMark}> · propuesta por la IA</span>
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
          {sameSet(selected, proposedCodes) ? "Aceptar propuesta" : "Guardar corrección"}
        </button>
        <button type="button" className={styles.secondary} onClick={onDone} disabled={pending}>
          Cancelar
        </button>
      </div>
      {selected.length === 0 ? (
        <p className={styles.error}>
          Una revisión mantiene al menos una categoría. Si nada aplica, elige la categoría residual.
        </p>
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
