import { loadPortfolio, loadReportOverview } from "@eia/application";
import { can, SURFACE_DEFINITIONS } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { ReportOverviewPanel } from "@/components/reports/report-overview";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { projectPath } from "@/lib/navigation";
import { getTenantCapabilitySettings } from "@/lib/queries";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

import styles from "@/components/reports/reports.module.css";

export const dynamic = "force-dynamic";

/**
 * Report generation.
 *
 * `reports.social_generator` gates the route; `reports.write` gates both reading the versions and
 * producing one — a chapter is a working artefact of the team that writes it, and this slice does
 * not build a separate reviewer view of it (TD-060).
 */
export default async function ReportsPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string }>;
}) {
  const { tenant, project } = await params;
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

  const { ctx } = access;
  const sessionUser = await getSessionUser();
  const tenantSettings = await getTenantCapabilitySettings(ctx);
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
      SURFACE_DEFINITIONS.reports.label,
    ),
  };

  // The chapter counts validated codings of individual responses, so reading it requires the same
  // permission the responses themselves do (TENANCY.md §3.2).
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

  let overview;
  try {
    overview = await loadReportOverview(getDb(), ctx);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    throw error;
  }

  return (
    <WorkspaceShell {...shell}>
      <div className={styles.surface}>
        <ReportOverviewPanel
          overview={overview}
          tenant={ctx.tenantSlug}
          project={project}
          canGenerate={can(ctx, "reports.write")}
        />
      </div>
    </WorkspaceShell>
  );
}
