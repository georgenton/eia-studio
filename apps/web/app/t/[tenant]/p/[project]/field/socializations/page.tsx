import { listSocializationEvents, loadWorkspaceHeader } from "@eia/application";
import { can } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { SocializationsSurface } from "@/components/field/socializations";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { surfaceLabel } from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { projectPath } from "@/lib/navigation";
import { resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/** *Socializaciones* — the convocations of one road, under Trabajo de campo (ADR-041). */
export default async function SocializationsPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string }>;
}) {
  const { tenant, project } = await params;
  const access = await resolveSurfaceAccess(tenant, project, "field");

  if (access.kind === "unauthenticated") redirect("/sign-in");
  if (access.kind === "not-found") notFound();
  if (access.kind === "denied") {
    return (
      <main style={{ padding: "40px 26px" }}>
        <PermissionDeniedState
          backHref={`/t/${tenant}`}
          restrictedData={access.restrictedData}
          role={access.role}
        />
      </main>
    );
  }

  const { ctx, tenantSettings } = access;
  const { t } = await getI18n();
  const sessionUser = await getSessionUser();
  const header = await loadWorkspaceHeader(getDb(), ctx);
  const basePath = `${projectPath(ctx.tenantSlug, project, "field")}/socializations`;

  const shell = {
    ctx,
    tenantSettings,
    projects: header.projects,
    currentSurface: "field" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? t("shell.user"),
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      header.tenantName,
      projectLabel(header.projects, project),
      `${surfaceLabel(t, "field")} · ${t("field.socializations.title")}`,
      projectPath(ctx.tenantSlug, project, "field"),
    ),
  };

  if (!can(ctx, "field.socializations.manage")) {
    return (
      <WorkspaceShell {...shell}>
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            backHref={projectPath(ctx.tenantSlug, project, "field")}
            restrictedData={t("field.socializations.title")}
            role={ctx.projectRole ?? ctx.tenantRole}
          />
        </div>
      </WorkspaceShell>
    );
  }

  const events = await listSocializationEvents(getDb(), ctx);

  return (
    <WorkspaceShell {...shell}>
      <SocializationsSurface
        basePath={basePath}
        defaultTimezone="America/Guayaquil"
        events={events}
        project={project}
        tenant={tenant}
      />
    </WorkspaceShell>
  );
}
