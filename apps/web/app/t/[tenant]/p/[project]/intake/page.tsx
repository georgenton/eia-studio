import { loadProjectIntake, loadWorkspaceHeader } from "@eia/application";
import { can } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { ProjectIntake } from "@/components/intake/project-intake";
import { isIntakeStage } from "@/components/intake/stages";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { surfaceLabel } from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { projectPath } from "@/lib/navigation";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/**
 * *Preparar proyecto* (ADR-030).
 *
 * `core.projects` gates the route — preparing a project is not a module a tenant buys, it is the
 * project — and `project.intake.read` gates the content. A technician has the capability and not
 * the permission, and gets the denial state rather than a 404, because the surface exists for this
 * project and the answer is about *them* (ADR-016).
 */
export default async function ProjectIntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; project: string }>;
  searchParams: Promise<{ stage?: string }>;
}) {
  const { tenant, project } = await params;
  const { stage: rawStage } = await searchParams;
  const access = await resolveSurfaceAccess(tenant, project, "intake");

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
  const basePath = projectPath(ctx.tenantSlug, project, "intake");

  const shell = {
    ctx,
    tenantSettings,
    projects: header.projects,
    currentSurface: "intake" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? t("shell.user"),
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      header.tenantName,
      projectLabel(header.projects, project),
      surfaceLabel(t, "intake"),
    ),
  };

  if (!can(ctx, "project.intake.read")) {
    return (
      <WorkspaceShell {...shell}>
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            role={ctx.projectRole ?? ctx.tenantRole}
            restrictedData={t("intake.title")}
            backHref={projectPath(ctx.tenantSlug, project, "")}
          />
        </div>
      </WorkspaceShell>
    );
  }

  let view;
  try {
    view = await loadProjectIntake(getDb(), ctx);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    if (outcome?.kind === "denied") {
      return (
        <WorkspaceShell {...shell}>
          <PermissionDeniedState
            role={outcome.role}
            restrictedData={outcome.restrictedData}
            backHref={projectPath(ctx.tenantSlug, project, "")}
          />
        </WorkspaceShell>
      );
    }
    throw error;
  }

  return (
    <WorkspaceShell {...shell}>
      <ProjectIntake
        basePath={basePath}
        project={project}
        stage={isIntakeStage(rawStage) ? rawStage : "project"}
        tenant={ctx.tenantSlug}
        view={view}
      />
    </WorkspaceShell>
  );
}
