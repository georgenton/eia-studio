import { loadWorkspaceHeader, loadReportVersion } from "@eia/application";
import { can } from "@eia/domain";
import type { MessageKey, Translator } from "@eia/i18n";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { notFound, redirect } from "next/navigation";

import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { regimeLabel, surfaceLabel } from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { projectPath } from "@/lib/navigation";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

import styles from "@/components/reports/reports.module.css";

export const dynamic = "force-dynamic";

/**
 * One line naming where a figure came from.
 *
 * The snapshot's own prose is Spanish because a report is a Spanish deliverable (ADR-029 §5); this
 * line is interface chrome around it, so it follows the reader.
 */
function sourceLine(source: Record<string, unknown>, t: Translator): string {
  const kind = String(source.kind);
  const label = t(`reports.sourceKind.${kind}` as MessageKey);
  switch (kind) {
    case "metric":
      return t("reports.sourceMetric", {
        label,
        metric: String(source.metric),
        method: String(source.method),
      });
    case "human_review":
      return t("reports.sourceHumanReview", {
        label,
        reviews: String(source.reviews),
        taxonomy: String(source.taxonomyVersionLabel),
      });
    case "quality_finding":
      return t("reports.sourceFinding", {
        label,
        code: String(source.findingCode),
        state: String(source.state),
      });
    case "document_chunk":
      return t("reports.sourceDocument", {
        label,
        code: String(source.documentCode),
        version: String(source.versionLabel),
        page: source.page === null ? "" : t("reports.sourcePage", { page: String(source.page) }),
      });
    case "provenance": {
      const facets = source.facets as { regime: string; transformations: string[] };
      return t("reports.sourceProvenance", {
        label,
        regime: regimeLabel(t, facets.regime),
        transformations: facets.transformations.join(" → "),
      });
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
  const i18n = await getI18n();
  const { t } = i18n;
  const sessionUser = await getSessionUser();
  const header = await loadWorkspaceHeader(getDb(), ctx);

  const shell = {
    ctx,
    tenantSettings,
    projects: header.projects,
    currentSurface: "reports" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? t("shell.user"),
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      header.tenantName,
      projectLabel(header.projects, project),
      `${surfaceLabel(t, "reports")} · ${versionLabel}`,
      projectPath(ctx.tenantSlug, project, "reports"),
    ),
  };

  if (!can(ctx, "reports.write") || !can(ctx, "field.responses.read")) {
    return (
      <WorkspaceShell {...shell}>
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            role={ctx.projectRole ?? ctx.tenantRole}
            restrictedData={t("reports.restrictedData")}
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
            label={t("reports.versionTitle", { version: version.versionLabel })}
            note={t("reports.versionNote", {
              questionnaire: version.surveyVersionLabel,
              facts: i18n.fmt.count(version.factCount),
            })}
            action={
              <a
                className={styles.download}
                href={`/t/${ctx.tenantSlug}/p/${project}/reports/${version.versionLabel}/docx`}
              >
                {t("reports.downloadDocx")}
              </a>
            }
          />
          <PanelBody>
            <p className={styles.draftBanner}>{t("reports.draftShort")}</p>
            {version.superseded ? (
              <p className={styles.draftBanner}>{t("reports.supersededNote")}</p>
            ) : null}
            <p className={styles.note}>
              {t("reports.regimesPresent", {
                regimes: version.snapshot.regimes
                  .map((regime) => regimeLabel(t, regime))
                  .join(" · "),
              })}
              {version.narrativeModel
                ? t("reports.narrativeModel", { model: version.narrativeModel })
                : t("reports.noNarrativeModel")}
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
                      {sourceLine(fact.source as unknown as Record<string, unknown>, t)}
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
