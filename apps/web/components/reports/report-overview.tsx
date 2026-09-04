"use client";

import type { ReportOverview } from "@eia/application";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import Link from "next/link";
import { useState, useTransition } from "react";

import { generateChapterAction } from "@/lib/report-actions";

import styles from "./reports.module.css";

/**
 * The chapter's versions.
 *
 * A version is the unit, and every one of them stays: regenerating produces a new one, and the
 * previous keeps exactly what it said. The list is the chapter's history, not a stack of drafts to
 * clean up.
 */
const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-EC", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso));

export function ReportOverviewPanel({
  overview,
  tenant,
  project,
  canGenerate,
}: {
  overview: ReportOverview;
  tenant: string;
  project: string;
  canGenerate: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const generate = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await generateChapterAction({ tenant, project });
      setFailed(!result.ok);
      setMessage(result.ok ? result.message : result.error);
    });
  };

  return (
    <Panel>
      <PanelHeader
        label={overview.title}
        note={
          overview.versions.length === 0
            ? "Todavía no se ha generado ninguna versión"
            : `${overview.versions.length} versión(es)`
        }
        action={
          canGenerate ? (
            <button className={styles.primary} type="button" onClick={generate} disabled={pending}>
              {pending ? "Generando…" : "Generar versión"}
            </button>
          ) : null
        }
      />
      <PanelBody>
        <p className={styles.draftBanner}>
          <strong>Borrador, no entregable.</strong> Cada versión se construye a partir de datos
          validados — tabulación determinista, codificaciones validadas por especialista, hallazgos
          de calidad decididos y documentos citados por versión — y ninguna afirmación constituye
          una conclusión de cumplimiento normativo. Las propuestas automáticas sin validar no entran
          en ninguna cifra.
        </p>
        <p className={styles.note}>
          Una versión no se edita. Cuando cambian los datos validados se genera una versión nueva, y
          la anterior conserva exactamente lo que decía.
        </p>

        {message ? (
          <p
            className={`${styles.feedback} ${failed ? styles.bad : styles.ok}`}
            role="status"
            aria-live="polite"
          >
            {message}
          </p>
        ) : null}

        {overview.versions.length > 0 ? (
          <table className={styles.table} style={{ marginTop: 12 }}>
            <caption className="sr-only">Versiones del capítulo social</caption>
            <thead>
              <tr>
                <th scope="col">Versión</th>
                <th scope="col">Generada</th>
                <th scope="col">Cuestionario</th>
                <th scope="col">Cifras</th>
                <th scope="col">Redacción</th>
                <th scope="col">Descarga</th>
              </tr>
            </thead>
            <tbody>
              {overview.versions.map((version) => (
                <tr key={version.id}>
                  <td className={styles.code}>
                    <Link
                      className={styles.versionLink}
                      href={`/t/${tenant}/p/${project}/reports/${version.versionLabel}`}
                    >
                      {version.versionLabel}
                    </Link>
                    {version.current ? " · vigente" : ""}
                  </td>
                  <td>
                    {dateTime(version.generatedAt)}
                    {version.generatedBy ? (
                      <div className={styles.factSource}>{version.generatedBy}</div>
                    ) : null}
                  </td>
                  <td className={styles.code}>{version.surveyVersionLabel}</td>
                  <td>{version.factCount}</td>
                  <td>{version.narrativeModel ?? "sin redacción"}</td>
                  <td>
                    <a
                      className={styles.download}
                      href={`/t/${tenant}/p/${project}/reports/${version.versionLabel}/docx`}
                    >
                      .docx
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
