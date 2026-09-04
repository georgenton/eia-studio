import { loadFindingDetail, loadPortfolio } from "@eia/application";
import { can, SURFACE_DEFINITIONS } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { FindingDetailPanel } from "@/components/quality/finding-detail";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { projectPath } from "@/lib/navigation";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

import styles from "@/components/quality/quality.module.css";

export const dynamic = "force-dynamic";

/**
 * One finding.
 *
 * A finding code is not probeable: a code in a project the caller cannot see and a code that does
 * not exist both answer 404, so neither confirms anything — the same rule the parcel workspace
 * follows.
 */
export default async function FindingPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string; findingCode: string }>;
}) {
  const { tenant, project, findingCode } = await params;
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

  const { ctx, tenantSettings } = access;
  const sessionUser = await getSessionUser();
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
      projectLabel(portfolio.projects, project),
      `${SURFACE_DEFINITIONS.quality.label} · ${findingCode}`,
      projectPath(ctx.tenantSlug, project, "quality"),
    ),
  };

  if (!can(ctx, "quality.read")) {
    return (
      <WorkspaceShell {...shell}>
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

  let finding;
  try {
    finding = await loadFindingDetail(getDb(), ctx, findingCode);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    throw error;
  }

  return (
    <WorkspaceShell {...shell}>
      <div className={styles.surface}>
        <FindingDetailPanel
          finding={finding}
          tenant={ctx.tenantSlug}
          project={project}
          canDecide={can(ctx, "quality.review")}
        />
      </div>
    </WorkspaceShell>
  );
}
