"use client";

import type { AssistantResponse } from "@eia/application";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useState, useTransition } from "react";

import { askDocumentsAction } from "@/lib/document-actions";

import styles from "./documents.module.css";

/**
 * Ask the project's documents a question.
 *
 * The shape of the surface is the shape of the guarantee (ADR-021): the **citations are the
 * answer**, and the paragraph above them — when a generator is configured — is a reading of those
 * exact passages. Where no generator is configured the passages appear on their own with the reason
 * stated, because that is still the useful half and pretending otherwise would be the lie this
 * layer exists to avoid.
 *
 * The retrieval strategy is named on screen, in words: a reader is told these passages contain
 * these words, not led to believe a model understood the question.
 */
export function DocumentAssistant({ tenant, project }: { tenant: string; project: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ask = () => {
    setError(null);
    startTransition(async () => {
      const result = await askDocumentsAction({ tenant, project, question });
      if (result.ok) {
        setAnswer(result.answer);
      } else {
        setAnswer(null);
        setError(result.error);
      }
    });
  };

  return (
    <Panel>
      <PanelHeader
        label="Consulta al expediente"
        note="Responde únicamente con pasajes de los documentos del proyecto"
      />
      <PanelBody>
        <p className={styles.note}>
          El asistente no responde de memoria: busca en los documentos de <strong>este</strong>{" "}
          proyecto y cita el pasaje exacto, con su documento, su versión y su página. Si no
          encuentra evidencia, lo dice.
        </p>
        <form
          className={styles.ask}
          onSubmit={(event) => {
            event.preventDefault();
            ask();
          }}
        >
          <label className="sr-only" htmlFor="question">
            Pregunta al expediente
          </label>
          <input
            className={styles.input}
            id="question"
            name="question"
            type="text"
            value={question}
            placeholder="¿Cuántos predios afectados declara el expediente?"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button
            className={styles.primary}
            type="submit"
            disabled={pending || question.trim().length < 3}
          >
            {pending ? "Buscando…" : "Consultar"}
          </button>
        </form>

        {error ? (
          <p className={styles.unavailable} role="alert">
            {error}
          </p>
        ) : null}

        {answer ? (
          <div style={{ marginTop: 14 }} data-testid="assistant-answer">
            {answer.narrative ? <p className={styles.narrative}>{answer.narrative}</p> : null}
            {answer.narrativeUnavailable ? (
              <p className={styles.unavailable} data-system-state="ai-unavailable">
                {answer.narrativeUnavailable}
              </p>
            ) : null}

            {answer.citations.length > 0 ? (
              <ul className={styles.citations}>
                {answer.citations.map((citation) => (
                  <li className={styles.citation} key={citation.chunkId}>
                    <span className={styles.citationHead}>
                      <span className={styles.citationRef}>
                        {citation.documentCode} {citation.versionLabel}
                        {citation.page === null ? "" : ` · p. ${citation.page}`}
                        {` · pasaje ${citation.passage}`}
                      </span>
                      <span className={styles.citationTitle}>{citation.documentTitle}</span>
                    </span>
                    <blockquote className={styles.quote}>{citation.quote}</blockquote>
                  </li>
                ))}
              </ul>
            ) : null}

            <p className={styles.strategy} style={{ marginTop: 12 }}>
              <strong>{answer.strategyLabel}.</strong> {answer.strategyHelp}
            </p>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
