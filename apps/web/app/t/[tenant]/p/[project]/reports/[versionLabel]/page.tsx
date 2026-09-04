import { loadPortfolio, loadReportVersion } from "@eia/application";
import { can, SURFACE_DEFINITIONS } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { notFound, redirect } from "next/navigation";

import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { projectPath } from "@/lib/navigation";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

import styles from "@/components/reports/reports.module.css";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  metric: "Cálculo determinista",
  human_review: "Codificación validada por especialista",
  quality_finding: "Hallazgo de calidad",
  document_chunk: "Pasaje citado del expediente",
  provenance: "Registro de procedencia",
};

const REGIME_LABEL: Record<string, string> = {
  HISTORICAL_OBSERVED: "Dato histórico observado",
  LIVE_OPERATIONAL: "Operación en curso",
  DEMO_SIMULATION: "Simulación de demostración",
};

/** One line naming where a figure came from. The same text the .docx prints under each fact. */
function sourceLine(source: Record<string, unknown>): string {
  const kind = String(source.kind);
  const label = SOURCE_LABEL[kind] ?? kind;
  switch (kind) {
    case "metric":
      return `${label} · ${String(source.metric)} — ${String(source.method)}`;
    case "human_review":
      return `${label} · ${String(source.reviews)} codificación(es) validada(s), taxonomía ${String(source.taxonomyVersionLabel)}`;
    case "quality_finding":
      return `${label} · ${String(source.findingCode)} (${String(source.state)})`;
    case "document_chunk": {
      const page = source.page === null ? "" : ` · p. ${String(source.page)}`;
      return `${label} · ${String(source.documentCode)} ${String(source.versionLabel)}${page}`;
    }
    case "provenance": {
      const facets = source.facets as { regime: string; transformations: string[] };
      return `${label} · ${REGIME_LABEL[facets.regime] ?? facets.regime} · ${facets.transformations.join(" → ")}`;
    }
    default:
      return label;
  }
}

/**
 * One version of the chapter.
 *
 * Every figure carries the source it came from, beneath it, in the reader's language. That is the
 * whole point of the snapshot: a reader can go from a number to the metric, the validated coding,
 * the decided finding or the cited passage it rests on, without leaving the page.
 */
export default async function ReportVersionPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string; versionLabel: string }>;
}) {
  const { tenant, project, versionLabel } = await params;
  const access = await resolveSurfaceAccess(tenant, project, "reports");

  if (access.kind === "unauthenticated") redirect("/sign-in");
  if (access.kind === "not-found") notFound();
  if (access.kind === "denied") {
    return (
      <main style={{ padding: "40px 26px" }}>
        <PermissionDeniedState
          role={access.role}
          restrictedData={access.restrictedData}
          backHref={`/t/${tenant}`}
        />
      </main>
    );
  }

  const { ctx, tenantSettings } = access;
  const sessionUser = await getSessionUser();
  const portfolio = await loadPortfolio(getDb(), ctx);

  const shell = {
    ctx,
    tenantSettings,
    projects: portfolio.projects,
    currentSurface: "reports" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? "Usuario",
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      portfolio.tenantName,
      projectLabel(portfolio.projects, project),
      `${SURFACE_DEFINITIONS.reports.label} · ${versionLabel}`,
      projectPath(ctx.tenantSlug, project, "reports"),
    ),
  };

  if (!can(ctx, "reports.write") || !can(ctx, "field.responses.read")) {
    return (
      <WorkspaceShell {...shell}>
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            role={ctx.projectRole ?? ctx.tenantRole}
            restrictedData="los borradores de informe del proyecto"
            backHref={projectPath(ctx.tenantSlug, project, "")}
          />
        </div>
      </WorkspaceShell>
    );
  }

  let version;
  try {
    version = await loadReportVersion(getDb(), ctx, versionLabel);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    throw error;
  }

  return (
    <WorkspaceShell {...shell}>
      <div className={styles.surface}>
        <Panel>
          <PanelHeader
            label={`Capítulo social · ${version.versionLabel}`}
            note={`Cuestionario ${version.surveyVersionLabel} · ${version.factCount} cifras`}
            action={
              <a
                className={styles.download}
                href={`/t/${ctx.tenantSlug}/p/${project}/reports/${version.versionLabel}/docx`}
              >
                Descargar .docx
              </a>
            }
          />
          <PanelBody>
            <p className={styles.draftBanner}>
              <strong>Borrador, no entregable.</strong> Ninguna afirmación de esta versión
              constituye una conclusión de cumplimiento normativo.
            </p>
            {version.superseded ? (
              <p className={styles.draftBanner}>
                Esta es una versión anterior. Se conserva porque dice lo que decía cuando se generó;
                la versión vigente puede decir otra cosa.
              </p>
            ) : null}
            <p className={styles.note}>
              Regímenes presentes:{" "}
              {version.snapshot.regimes.map((r) => REGIME_LABEL[r] ?? r).join(" · ")}.
              {version.narrativeModel
                ? ` Redacción asistida: ${version.narrativeModel}.`
                : " Sin redacción asistida: las cifras y sus fuentes son el contenido de esta versión."}
            </p>
          </PanelBody>
        </Panel>

        {version.snapshot.sections.map((section) => (
          <Panel key={section.key}>
            <PanelHeader label={section.title} />
            <PanelBody>
              <p className={styles.sectionSummary}>{section.summary}</p>
              {version.narratives.get(section.key) ? (
                <p className={styles.narrative}>{version.narratives.get(section.key)}</p>
              ) : null}
              <ul className={styles.facts}>
                {section.facts.map((fact) => (
                  <li className={styles.fact} key={fact.key}>
                    <span className={styles.factHead}>
                      {fact.label}: <span className={styles.factValue}>{fact.value}</span>
                    </span>
                    {fact.basis ? <span className={styles.factBasis}>{fact.basis}</span> : null}
                    <span className={styles.factSource}>
                      {sourceLine(fact.source as unknown as Record<string, unknown>)}
                    </span>
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>
        ))}
      </div>
    </WorkspaceShell>
  );
}
