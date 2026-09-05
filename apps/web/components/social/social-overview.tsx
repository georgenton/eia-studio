"use client";

import type {
  ClassificationRunSummary,
  SocialDistributions,
  SocialWorkflowMetrics,
  TaxonomyVersionSummary,
} from "@eia/application";
import { AGREEMENT_SEMANTICS } from "@eia/domain";
import {
  Chip,
  formatCount,
  formatDateTime,
  formatPercent,
  Panel,
  PanelBody,
  PanelHeader,
} from "@eia/ui";
import { useState, useTransition } from "react";

import { startClassificationRunAction } from "@/lib/social-actions";

import styles from "./social.module.css";

/**
 * The workflow header: how much there is to code, how far the coding has got, and how often the
 * specialist has agreed with the model.
 *
 * The agreement figure is the one that most needs its wording watched. The reviewer decided while
 * looking at the proposal, so this is concordance between an assisted human and the thing that
 * assisted them — an operational measure. The label says "coincidencia", the help text says why it
 * is not accuracy, and neither the label nor the number is ever shortened to a percentage on its
 * own.
 */
export function SocialOverview({
  metrics,
  distributions,
  taxonomy,
  runs,
  tenant,
  project,
  surveyVersionId,
  questionId,
  canRunAi,
  aiStatus,
}: {
  metrics: SocialWorkflowMetrics;
  distributions: SocialDistributions;
  taxonomy: TaxonomyVersionSummary | null;
  runs: ReadonlyArray<ClassificationRunSummary>;
  tenant: string;
  project: string;
  surveyVersionId: string;
  questionId: string | null;
  canRunAi: boolean;
  /**
   * Whether this environment has a classifier at all (IG4-001). Separate from `canRunAi`, which is
   * about the person: one is "you may not", the other is "nothing here can".
   */
  aiStatus: { readonly available: boolean; readonly note: string };
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const startRun = () => {
    if (!taxonomy || !questionId) return;
    setMessage(null);
    startTransition(async () => {
      const result = await startClassificationRunAction({
        tenant,
        project,
        taxonomyVersionId: taxonomy.versionId,
        surveyVersionId,
        questionId,
      });
      setMessage(result.ok ? (result.message ?? "Ejecución creada.") : result.error);
    });
  };

  return (
    <div className={styles.overview}>
      <Panel>
        <PanelHeader
          label="Codificación de respuestas abiertas"
          action={
            aiStatus.available && canRunAi && taxonomy && questionId ? (
              <button
                type="button"
                className={styles.primary}
                onClick={startRun}
                disabled={pending || metrics.eligible === 0}
              >
                {pending ? "Creando ejecución…" : "Ejecutar codificación asistida"}
              </button>
            ) : null
          }
        />
        <PanelBody>
          {aiStatus.available ? null : (
            <p className={styles.note} data-system-state="ai-unavailable">
              {aiStatus.note}
            </p>
          )}
          <dl className={styles.kpis}>
            <Kpi label="Respuestas abiertas" value={formatCount(metrics.eligible)} />
            <Kpi label="Propuestas listas" value={formatCount(metrics.succeededAi)} />
            <Kpi label="Pendientes de revisión" value={formatCount(metrics.pendingReview)} />
            <Kpi label="Validadas" value={formatCount(metrics.reviewed)} />
            <Kpi
              label={AGREEMENT_SEMANTICS.label}
              value={
                metrics.agreement.agreementRate === null
                  ? "—"
                  : formatPercent(metrics.agreement.agreementRate)
              }
              help={AGREEMENT_SEMANTICS.help}
            />
            <Kpi
              label={AGREEMENT_SEMANTICS.overrideLabel}
              value={formatCount(metrics.agreement.overrides)}
            />
          </dl>

          {metrics.pendingAi > 0 || metrics.processingAi > 0 ? (
            <p className={styles.note} data-system-state="syncing">
              {formatCount(metrics.pendingAi + metrics.processingAi)} respuesta(s) en la cola de
              clasificación. El proceso de fondo las toma de a una; esta pantalla las muestra en
              cuanto terminan.
            </p>
          ) : null}
          {metrics.failedAi > 0 ? (
            <p className={styles.note} data-system-state="error">
              {formatCount(metrics.failedAi)} clasificación(es) fallida(s). La tabulación
              determinista no se ve afectada: sigue disponible arriba.
            </p>
          ) : null}
          {message ? <p className={styles.message}>{message}</p> : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label="Temas validados" />
        <PanelBody>
          <p className={styles.note}>
            Solo cuenta lo que un especialista decidió. Base:{" "}
            {formatCount(distributions.validated.reviewed)} respuesta(s) validada(s);{" "}
            {formatCount(distributions.validated.unreviewed)} sin revisar quedan fuera y no se
            extrapolan. Una respuesta puede llevar varios temas, así que los porcentajes pueden
            sumar más de 100 %.
          </p>
          <Distribution
            tallies={distributions.validated.tallies}
            emptyNote="Todavía no hay codificaciones validadas."
            variant="validated"
          />
        </PanelBody>
      </Panel>

      {distributions.provisional.tallies.length > 0 ? (
        <Panel>
          <PanelHeader
            label="Distribución provisional de la IA"
            action={<Chip tone="warn">Provisional · sin validar</Chip>}
          />
          <PanelBody>
            <p className={styles.note}>
              Lo que el modelo propuso, antes de cualquier decisión humana. Se muestra aparte y con
              su propia base ({formatCount(distributions.provisional.reviewed)} propuestas) para que
              no se confunda con el resultado validado.
            </p>
            <Distribution
              tallies={distributions.provisional.tallies}
              emptyNote="Sin propuestas."
              variant="provisional"
            />
          </PanelBody>
        </Panel>
      ) : null}

      {taxonomy ? (
        <Panel>
          <PanelHeader
            label="Esquema de codificación"
            action={<Chip tone="warn">Reconstruido</Chip>}
          />
          <PanelBody>
            <p className={styles.note}>
              Versión <strong>{taxonomy.versionLabel}</strong>. {taxonomy.sourceNote}
            </p>
            {/*
              The definition's fingerprint is what proves two codings were made against the same
              scheme. It is evidence, so it stays; it is not something a specialist reads while
              working, so it does not sit in the sentence above.
            */}
            {taxonomy.definitionHash ? (
              <details className={styles.technical}>
                <summary>Detalle técnico del esquema</summary>
                <p>
                  Huella de la definición: <code>{taxonomy.definitionHash}</code>. Dos
                  codificaciones hechas contra la misma huella se hicieron contra el mismo esquema.
                </p>
              </details>
            ) : null}
            <ul className={styles.categoryList}>
              {taxonomy.categories.map((category) => (
                <li key={category.code}>
                  <strong>{category.label}</strong>
                  <span className={styles.categoryDescription}>{category.description}</span>
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      ) : null}

      {runs.length > 0 ? (
        <Panel>
          <PanelHeader label="Codificaciones asistidas" note={`${runs.length} ejecución(es)`} />
          <PanelBody>
            <p className={styles.note}>
              Cada vez que se pidió al modelo que propusiera categorías, y qué devolvió. Son
              propuestas: ninguna entra en un resultado sin la decisión de un especialista.
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Cuándo</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Propuestas</th>
                  <th scope="col">Esquema</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.runId}>
                    <td>{run.startedAt ? formatDateTime(run.startedAt) : "—"}</td>
                    <td>{RUN_STATUS_LABEL[run.status] ?? run.status}</td>
                    <td>
                      {formatCount(run.succeeded)} de {formatCount(run.queued)}
                      {run.failed > 0 ? ` · ${formatCount(run.failed)} sin resultado` : ""}
                    </td>
                    <td>{run.taxonomyVersionLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/*
              Which model answered, through which adapter and against which prompt version is the
              record AI governance asks us to keep (AI_GOVERNANCE.md). It is kept, and it is one
              click away — it is an audit trail, not a working view.
            */}
            <details className={styles.technical}>
              <summary>Detalle técnico de las ejecuciones</summary>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Modelo solicitado</th>
                    <th scope="col">Modelo que respondió</th>
                    <th scope="col">Adaptador</th>
                    <th scope="col">Instrucción (versión · huella)</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.runId}>
                      <td>{run.requestedModel}</td>
                      <td>{run.resolvedModel ?? "—"}</td>
                      <td>{run.classifierKind}</td>
                      <td>
                        {run.promptVersion} · {run.promptHash}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}

/** Run states, in words. The keys are what the worker writes; these are what a person reads. */
const RUN_STATUS_LABEL: Readonly<Record<string, string>> = {
  QUEUED: "En cola",
  RUNNING: "En curso",
  COMPLETED: "Completada",
  FAILED: "Fallida",
  BLOCKED: "Bloqueada",
};

function Kpi({ label, value, help }: { label: string; value: string; help?: string }) {
  // Label, then figure, then explanation. The explanation belongs *under* the number it qualifies:
  // between the two it separates a reader from the thing they came to look at, and this particular
  // number is one nobody should read without its caveat.
  return (
    <div className={styles.kpi}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {help ? <dd className={styles.kpiHelp}>{help}</dd> : null}
    </div>
  );
}

function Distribution({
  tallies,
  emptyNote,
  variant,
}: {
  tallies: ReadonlyArray<{ code: string; label: string; count: number; share: number | null }>;
  emptyNote: string;
  variant: "validated" | "provisional";
}) {
  if (tallies.length === 0) {
    return (
      <p className={styles.note} data-system-state="empty">
        {emptyNote}
      </p>
    );
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Tema</th>
          <th scope="col">Respuestas</th>
          <th scope="col">Porcentaje</th>
          <th scope="col">
            <span className={styles.srOnly}>Distribución</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {tallies.map((tally) => (
          <tr key={tally.code}>
            <th scope="row">{tally.label}</th>
            <td>{formatCount(tally.count)}</td>
            <td>{tally.share === null ? "—" : formatPercent(tally.share)}</td>
            <td className={styles.barCell}>
              <div className={styles.barTrack}>
                <div
                  className={variant === "validated" ? styles.barFill : styles.barFillProvisional}
                  style={{ width: `${Math.round((tally.share ?? 0) * 100)}%` }}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
