import {
  loadProjectIntake,
  loadSurveyAuthoring,
  loadWorkspaceHeader,
  type SurveyAuthoringView,
} from "@eia/application";
import { can } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { ProjectIntake } from "@/components/intake/project-intake";
import { isIntakeStage } from "@/components/intake/stages";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { storageReadiness } from "@/lib/storage";
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
  searchParams: Promise<{ stage?: string; version?: string }>;
}) {
  const { tenant, project } = await params;
  const { stage: rawStage, version: rawVersion } = await searchParams;
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
    view = await loadProjectIntake(getDb(), ctx, storageReadiness());
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

  /*
   * The questionnaires stage reads its own model (ADR-037), and only when it is the stage being
   * looked at: authoring is the largest read on this page and the other seven stages have no use
   * for it. A caller who may not read it gets `null` and the stage falls back to the summary it
   * has always shown, rather than a denial for a page they are otherwise entitled to.
   */
  let authoring: SurveyAuthoringView | null = null;
  const stage = isIntakeStage(rawStage) ? rawStage : "project";
  if (stage === "surveys") {
    try {
      authoring = await loadSurveyAuthoring(getDb(), ctx, rawVersion ?? null);
    } catch (error) {
      // `accessForDomainError` answers `null` for anything that is not an access outcome, and an
      // unexpected error must still reach the error boundary rather than becoming a quiet fallback.
      if (accessForDomainError(error) === null) throw error;
    }
  }

  return (
    <WorkspaceShell {...shell}>
      <ProjectIntake
        authoring={authoring}
        basePath={basePath}
        project={project}
        stage={stage}
        tenant={ctx.tenantSlug}
        view={view}
      />
    </WorkspaceShell>
  );
}
