"use client";

import type { FindingDetail } from "@eia/application";
import { Chip, Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useState, useTransition } from "react";

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
const DECISION_LABEL: Record<string, string> = {
  START_REVIEW: "Tomar para revisión",
  ACCEPT: "Aceptar el hallazgo",
  DISMISS: "Descartar el hallazgo",
  RESOLVE: "Marcar como resuelto",
  REQUEST_INTERDISCIPLINARY: "Solicitar revisión interdisciplinaria",
  REOPEN: "Reabrir",
};

const DECISION_HELP: Record<string, string> = {
  START_REVIEW: "Queda a tu nombre mientras lo revisas.",
  ACCEPT: "La discrepancia es real. Aceptarla no dice cuál de las dos fuentes rige.",
  DISMISS: "Las fuentes son consistentes, o la regla las leyó mal.",
  RESOLVE: "Aceptado y ya corregido en el expediente.",
  REQUEST_INTERDISCIPLINARY: "Necesita el criterio de otra disciplina antes de decidirse.",
  REOPEN: "Hay información nueva, o la decisión anterior debe revisarse.",
};

const STATE_LABEL: Record<string, string> = {
  OPEN: "Abierto",
  UNDER_REVIEW: "En revisión",
  ACCEPTED: "Aceptado",
  DISMISSED: "Descartado",
  RESOLVED: "Resuelto",
};

const ROLE_LABEL: Record<string, string> = {
  SOURCE_A: "Fuente A",
  SOURCE_B: "Fuente B",
  CONTEXT: "Contexto",
};

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-EC", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso));

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
      setMessage(result.ok ? (result.message ?? "Decisión registrada.") : result.error);
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
          badge={<Chip tone="neutral">{STATE_LABEL[finding.state] ?? finding.state}</Chip>}
          note={`Detectado ${dateTime(finding.detectedAt)} · regla ${finding.requirementKey}@${finding.requirementVersion}`}
        />
        <PanelBody>
          <p className={styles.explain}>{finding.explanation}</p>
          {finding.interdisciplinary ? (
            <p className={styles.note}>
              <Chip tone="accent">Revisión interdisciplinaria</Chip> Este hallazgo contrasta
              criterios de más de una disciplina y no debería resolverse desde una sola.
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          label="Evidencia"
          note="Las dos fuentes, tal como están escritas. El sistema no decide cuál rige."
        />
        <PanelBody>
          <div className={styles.sources}>
            {sources.map((item, index) => (
              <div className={styles.source} key={`${item.role}-${index}`}>
                <span className={styles.sourceRole}>{ROLE_LABEL[item.role] ?? item.role}</span>
                <span className={styles.sourceLabel}>{item.label}</span>
                <blockquote className={styles.quote}>{item.quote}</blockquote>
                {item.documentRef ? (
                  <span className={styles.sourceRef}>
                    Transcrito de{" "}
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
                    {item.documentRef.chunkOrdinal === null
                      ? " El pasaje exacto no pudo identificarse por coincidencia literal."
                      : ""}
                  </span>
                ) : (
                  <span className={styles.sourceRef}>
                    {item.sourceRef
                      ? "Extracto reconstruido del expediente. Sin número de página: el documento todavía no está en el sistema."
                      : "Valor declarado en la ficha del proyecto."}
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
        <PanelHeader label="Por qué se señaló" />
        <PanelBody>
          <p className={styles.explain}>{finding.whyFlagged}</p>
          <p className={styles.note} style={{ marginTop: 10 }}>
            <strong>Acción sugerida.</strong> {finding.suggestedAction}
          </p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          label="Decisión de especialista"
          note={
            canDecide
              ? "Toda decisión exige una justificación y queda registrada de forma permanente."
              : "Tu rol puede consultar los hallazgos; decidirlos corresponde a un revisor."
          }
        />
        <PanelBody>
          {canDecide && finding.availableDecisions.length > 0 ? (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="decision">
                  Decisión
                </label>
                <select
                  className={styles.select}
                  id="decision"
                  value={decision}
                  onChange={(event) => setDecision(event.target.value)}
                >
                  {finding.availableDecisions.map((option) => (
                    <option key={option} value={option}>
                      {DECISION_LABEL[option] ?? option}
                    </option>
                  ))}
                </select>
                <span className={styles.sourceRef}>{DECISION_HELP[decision] ?? ""}</span>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="justification">
                  Justificación
                </label>
                <textarea
                  className={styles.textarea}
                  id="justification"
                  value={justification}
                  onChange={(event) => setJustification(event.target.value)}
                  placeholder="Qué se contrastó y con qué criterio se decide."
                />
                <span className={styles.sourceRef}>
                  Mínimo 12 caracteres. Se conserva de forma permanente y con tu nombre.
                </span>
              </div>
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  type="button"
                  onClick={submit}
                  disabled={pending || justification.trim().length < 12}
                >
                  {pending ? "Registrando…" : "Registrar decisión"}
                </button>
              </div>
            </>
          ) : (
            <p className={styles.note}>
              {canDecide
                ? "Este hallazgo no admite más transiciones desde su estado actual."
                : "Solo un rol con permiso de revisión puede registrar una decisión."}
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
          label="Historial de decisiones"
          note={
            finding.reviews.length === 0
              ? "Todavía nadie ha decidido sobre este hallazgo"
              : `${finding.reviews.length} decisión(es)`
          }
        />
        <PanelBody>
          {finding.reviews.length === 0 ? (
            <p className={styles.note}>
              Cuando alguien decida, la decisión y su justificación quedarán aquí. No se editan ni
              se borran: un cambio de criterio es una decisión nueva.
            </p>
          ) : (
            <ol className={styles.history}>
              {finding.reviews.map((review, index) => (
                <li className={styles.historyItem} key={index}>
                  <span className={styles.historyHead}>
                    {DECISION_LABEL[review.decision] ?? review.decision} ·{" "}
                    {STATE_LABEL[review.fromState] ?? review.fromState} →{" "}
                    {STATE_LABEL[review.toState] ?? review.toState}
                  </span>
                  <span className={styles.historyMeta}>
                    {review.reviewerName ?? "Revisor"} · {dateTime(review.reviewedAt)}
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
