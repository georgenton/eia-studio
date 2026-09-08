import {
  buildClientPublicationDraft,
  loadPortalManagement,
  loadWorkspaceHeader,
} from "@eia/application";
import { can, SURFACE_DEFINITIONS } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { PortalManagementPanel } from "@/components/portal/portal-management";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { projectPath } from "@/lib/navigation";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/**
 * `Portal del cliente` — where the firm prepares and publishes what the customer sees.
 *
 * `client.portal` gates the route; `portal.preview` gates reading the draft and the history, and
 * `portal.publish` gates the button. A reviewer therefore checks an update before it goes out
 * without being able to send it, which is what the role means everywhere else in this product.
 */
export default async function PortalPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string }>;
}) {
  const { tenant, project } = await params;
  const access = await resolveSurfaceAccess(tenant, project, "portal");

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
  const sessionUser = await getSessionUser();
  const header = await loadWorkspaceHeader(getDb(), ctx);

  const shell = {
    ctx,
    tenantSettings,
    projects: header.projects,
    currentSurface: "portal" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? "Usuario",
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      header.tenantName,
      projectLabel(header.projects, project),
      SURFACE_DEFINITIONS.portal.label,
    ),
  };

  if (!can(ctx, "portal.preview")) {
    return (
      <WorkspaceShell {...shell}>
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            backHref={projectPath(ctx.tenantSlug, project, "")}
            restrictedData="las publicaciones al portal del cliente"
            role={ctx.projectRole ?? ctx.tenantRole}
          />
        </div>
      </WorkspaceShell>
    );
  }

  let management;
  let draft;
  try {
    [management, draft] = await Promise.all([
      loadPortalManagement(getDb(), ctx),
      buildClientPublicationDraft(getDb(), ctx),
    ]);
  } catch (error) {
    if (accessForDomainError(error)?.kind === "not-found") notFound();
    throw error;
  }

  return (
    <WorkspaceShell {...shell}>
      <PortalManagementPanel
        canPublish={can(ctx, "portal.publish")}
        draft={draft}
        management={management}
        project={project}
        tenant={tenant}
      />
    </WorkspaceShell>
  );
}
