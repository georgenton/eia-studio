import {
  listEligibleTechnicians,
  loadCurrentAssignmentBoard,
  loadWorkspaceHeader,
} from "@eia/application";
import { can } from "@eia/domain";
import { EmptyState } from "@eia/ui";
import { notFound, redirect } from "next/navigation";

import { AssignmentBoardSurface } from "@/components/field/assignment-board";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { surfaceLabel } from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { projectPath } from "@/lib/navigation";
import { resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/**
 * *Asignación de predios* — the surface `field.assignments.manage` was written for.
 *
 * A sub-route of Trabajo de campo rather than a product of its own: it is the same campaign, the
 * same parcels and the same people the field inbox already shows, looked at from the question
 * *who is going?*
 */
export default async function AssignmentsPage({
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
      `${surfaceLabel(t, "field")} · ${t("field.assignments.title")}`,
      projectPath(ctx.tenantSlug, project, "field"),
    ),
  };

  if (!can(ctx, "field.assignments.manage")) {
    return (
      <WorkspaceShell {...shell}>
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            backHref={projectPath(ctx.tenantSlug, project, "field")}
            restrictedData={t("field.assignments.title")}
            role={ctx.projectRole ?? ctx.tenantRole}
          />
        </div>
      </WorkspaceShell>
    );
  }

  const board = await loadCurrentAssignmentBoard(getDb(), ctx);
  if (board === null) {
    return (
      <WorkspaceShell {...shell}>
        <EmptyState title={t("field.assignments.noCampaign")} />
      </WorkspaceShell>
    );
  }
  const technicians = await listEligibleTechnicians(getDb(), ctx, board.campaignId);

  return (
    <WorkspaceShell {...shell}>
      <AssignmentBoardSurface
        board={board}
        project={project}
        technicians={technicians}
        tenant={tenant}
      />
    </WorkspaceShell>
  );
}
