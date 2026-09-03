"use client";

import type { QualityOverview } from "@eia/application";
import { Chip, Panel, PanelBody, PanelHeader, StatusChip, type ChipTone } from "@eia/ui";
import Link from "next/link";
import { useState, useTransition } from "react";

import { runQualityCheckAction } from "@/lib/quality-actions";

import styles from "./quality.module.css";

/**
 * The Quality Gate's list.
 *
 * Two things it is careful about.
 *
 * **It shows what was checked, not only what was found.** A gate that lists nothing looks
 * identical whether it ran and found nothing or never ran at all, so the rule catalogue and the
 * last run's timestamp are on the page beside the findings.
 *
 * **Colour never carries the meaning alone.** Severity and state are words first; the chip's tone
 * is a second channel (design v0.2, accessibility baseline).
 */
const SEVERITY_LABEL: Record<string, string> = { high: "Alta", medium: "Media", low: "Baja" };
const SEVERITY_TONE: Record<string, ChipTone> = { high: "crit", medium: "warn", low: "neutral" };

const STATE_LABEL: Record<string, string> = {
  OPEN: "Abierto",
  UNDER_REVIEW: "En revisión",
  ACCEPTED: "Aceptado",
  DISMISSED: "Descartado",
  RESOLVED: "Resuelto",
};
const STATE_TONE: Record<string, ChipTone> = {
  OPEN: "warn",
  UNDER_REVIEW: "accent",
  ACCEPTED: "crit",
  DISMISSED: "neutral",
  RESOLVED: "ok",
};

const TYPE_LABEL: Record<string, string> = {
  NUMERICAL_MISMATCH: "Numérica",
  GEOGRAPHICAL_MISMATCH: "Geográfica",
  TEMPORAL_MISMATCH: "Temporal",
  DOCUMENT_COMPLETENESS: "Completitud",
  CROSS_DOCUMENT_INCONSISTENCY: "Entre documentos",
  MISSING_EVIDENCE: "Evidencia insuficiente",
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

export function QualityOverviewPanel({
  overview,
  tenant,
  project,
  canRun,
}: {
  overview: QualityOverview;
  tenant: string;
  project: string;
  canRun: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await runQualityCheckAction({ tenant, project });
      setFailed(!result.ok);
      setMessage(result.ok ? (result.message ?? "Revisión ejecutada.") : result.error);
    });
  };

  return (
    <>
      <Panel>
        <PanelHeader
          label="Quality Gate"
          note={
            overview.lastRun?.finishedAt
              ? `Última revisión: ${dateTime(overview.lastRun.finishedAt)}`
              : "Todavía no se ha ejecutado ninguna revisión"
          }
          action={
            canRun ? (
              <button className={styles.primary} type="button" onClick={run} disabled={pending}>
                {pending ? "Ejecutando…" : "Ejecutar revisión"}
              </button>
            ) : null
          }
        />
        <PanelBody>
          <p className={styles.note}>
            El Quality Gate señala <strong>discrepancias entre dos fuentes</strong> del expediente.
            No determina cuál de las dos es correcta, ni declara conformidad: esa decisión, con su
            justificación, es de un especialista y queda registrada de forma permanente.
          </p>
          <dl className={styles.kpis}>
            <Kpi label="Abiertos" value={overview.counts.open} />
            <Kpi label="En revisión" value={overview.counts.underReview} />
            <Kpi label="Severidad alta" value={overview.counts.high} />
            <Kpi label="Aceptados" value={overview.counts.accepted} />
            <Kpi label="Resueltos" value={overview.counts.resolved} />
            <Kpi label="Descartados" value={overview.counts.dismissed} />
          </dl>
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
        <PanelHeader label="Hallazgos" note={`${overview.findings.length} en total`} />
        <PanelBody>
          {overview.findings.length === 0 ? (
            <p className={styles.note} data-system-state="no-findings">
              {overview.lastRun
                ? "La última revisión no encontró discrepancias entre las fuentes que compara el " +
                  "conjunto de reglas vigente."
                : "Todavía no se ha ejecutado ninguna revisión sobre este proyecto."}
            </p>
          ) : (
            <table className={styles.table}>
              <caption className="sr-only">
                Hallazgos de calidad, ordenados por estado y severidad
              </caption>
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Hallazgo</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Severidad</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {overview.findings.map((finding) => (
                  <tr key={finding.id}>
                    <td className={styles.code}>
                      <Link
                        className={styles.findingLink}
                        href={`/t/${tenant}/p/${project}/quality/${finding.code}`}
                      >
                        {finding.code}
                      </Link>
                    </td>
                    <td>
                      {finding.title}
                      {finding.interdisciplinary ? (
                        <>
                          {" "}
                          <Chip tone="accent">Revisión interdisciplinaria</Chip>
                        </>
                      ) : null}
                    </td>
                    <td>{TYPE_LABEL[finding.type] ?? finding.type}</td>
                    <td>
                      <Chip tone={SEVERITY_TONE[finding.severity] ?? "neutral"}>
                        {SEVERITY_LABEL[finding.severity] ?? finding.severity}
                      </Chip>
                    </td>
                    <td>
                      <StatusChip
                        label={STATE_LABEL[finding.state] ?? finding.state}
                        tone={STATE_TONE[finding.state] ?? "neutral"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          label="Reglas vigentes"
          note="Lo que esta revisión comprueba, haya encontrado algo o no"
        />
        <PanelBody>
          <ul className={styles.ruleList}>
            {overview.requirements.map((requirement) => (
              <li className={styles.ruleItem} key={requirement.key}>
                <span className={styles.ruleName}>
                  {requirement.title}{" "}
                  <span className={styles.code}>
                    {requirement.key}@{requirement.version}
                  </span>
                </span>
                <span className={styles.ruleWhat}>{requirement.what}</span>
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.kpi}>
      <dt className={styles.kpiLabel}>{label}</dt>
      <dd className={styles.kpiValue}>{new Intl.NumberFormat("es-EC").format(value)}</dd>
    </div>
  );
}
