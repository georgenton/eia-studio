import {
  listEligibleTechnicians,
  listInvitationCandidates,
  loadCurrentAssignmentBoard,
  loadSocializationEvent,
  loadWorkspaceHeader,
} from "@eia/application";
import { can } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { SocializationEventSurface } from "@/components/field/socialization-event";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { surfaceLabel } from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { projectPath } from "@/lib/navigation";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/** One convocation: its invitations, their attempts, and the parcels still to invite. */
export default async function SocializationEventPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string; eventId: string }>;
}) {
  const { tenant, project, eventId } = await params;
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
      basePath,
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

  const mayAssign = can(ctx, "field.assignments.manage");

  // Data first, JSX after, for the reason the field overview gives: elements built inside a
  // try/catch do not have their render errors caught by it.
  let event: Awaited<ReturnType<typeof loadSocializationEvent>>;
  let candidates: Awaited<ReturnType<typeof listInvitationCandidates>>;
  let technicians: Awaited<ReturnType<typeof listEligibleTechnicians>> = [];
  try {
    event = await loadSocializationEvent(getDb(), ctx, eventId);
    candidates = await listInvitationCandidates(getDb(), ctx, eventId);
    /*
     * Choosing who delivers is `field.assignments.manage`, a separate key from managing the
     * convocation, and the campaign is optional: a project whose survey campaign is closed still
     * convenes its corridor, which is the case this whole block exists for.
     */
    const board = mayAssign ? await loadCurrentAssignmentBoard(getDb(), ctx) : null;
    technicians = mayAssign
      ? await listEligibleTechnicians(getDb(), ctx, board?.campaignId ?? null)
      : [];
  } catch (error) {
    if (accessForDomainError(error)?.kind === "not-found") notFound();
    throw error;
  }

  return (
    <WorkspaceShell {...shell}>
      <SocializationEventSurface
        candidates={candidates}
        event={event}
        invitationPrintBase={`${basePath}/invitations`}
        listPath={basePath}
        project={project}
        technicians={technicians}
        tenant={tenant}
      />
    </WorkspaceShell>
  );
}
