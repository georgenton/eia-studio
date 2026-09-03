import { loadPortfolio, loadQualityOverview } from "@eia/application";
import { can, SURFACE_DEFINITIONS } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { QualityOverviewPanel } from "@/components/quality/quality-overview";
import { projectBreadcrumb, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { projectPath } from "@/lib/navigation";
import { getTenantCapabilitySettings } from "@/lib/queries";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

import styles from "@/components/quality/quality.module.css";

export const dynamic = "force-dynamic";

/**
 * Quality Gate.
 *
 * Capability and permission do different jobs, visibly:
 *
 * - `quality.document_gate` gates the route (404 when ineffective, ADR-016);
 * - `quality.read` gates the list — a technician has none of these and is denied;
 * - `quality.write` gates running the check;
 * - `quality.review` gates settling a finding, and lives on the detail page.
 */
export default async function QualityPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string }>;
}) {
  const { tenant, project } = await params;
  const access = await resolveSurfaceAccess(tenant, project, "quality");

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
    currentSurface: "quality" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? "Usuario",
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      portfolio.tenantName,
      project,
      SURFACE_DEFINITIONS.quality.label,
    ),
  };

  if (!can(ctx, "quality.read")) {
    return (
      <WorkspaceShell {...shell}>
        {/* Not a second <main>: the shell already provides this page's one landmark. */}
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            role={ctx.projectRole ?? ctx.tenantRole}
            restrictedData="la revisión de calidad del expediente"
            backHref={projectPath(ctx.tenantSlug, project, "")}
          />
        </div>
      </WorkspaceShell>
    );
  }

  let overview;
  try {
    overview = await loadQualityOverview(getDb(), ctx);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    throw error;
  }

  return (
    <WorkspaceShell {...shell}>
      <div className={styles.surface}>
        <QualityOverviewPanel
          overview={overview}
          tenant={ctx.tenantSlug}
          project={project}
          canRun={can(ctx, "quality.write")}
        />
      </div>
    </WorkspaceShell>
  );
}
