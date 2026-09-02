import { loadCommandCenter, loadPortfolio } from "@eia/application";
import { SURFACE_DEFINITIONS } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { CommandCenter } from "@/components/command-center";
import { ProvenancePanel } from "@/components/provenance-panel";
import { projectBreadcrumb, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { lifecycleLabel } from "@/lib/lifecycle";
import { projectPath } from "@/lib/navigation";
import { getTenantCapabilitySettings } from "@/lib/queries";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/**
 * Command Center (design v0.2 §2). Access is decided by the one capability policy (ADR-016)
 * before any data is read; the read model then re-checks the capability and the permission, so a
 * hidden rail item is never the control.
 */
export default async function CommandCenterPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; project: string }>;
  searchParams: Promise<{ prov?: string }>;
}) {
  const { tenant, project } = await params;
  const { prov } = await searchParams;
  const access = await resolveSurfaceAccess(tenant, project, "command-center");

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
  const basePath = projectPath(ctx.tenantSlug, project, "");

  const shellProps = {
    ctx,
    tenantSettings,
    projects: portfolio.projects,
    currentSurface: "command-center" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? "Usuario",
  };

  let view;
  try {
    view = await loadCommandCenter(getDb(), ctx);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    if (outcome?.kind === "denied") {
      return (
        <WorkspaceShell
          {...shellProps}
          breadcrumb={projectBreadcrumb(ctx, portfolio.tenantName, project, "Command Center")}
        >
          <PermissionDeniedState
            role={outcome.role}
            restrictedData={outcome.restrictedData}
            backHref={`/t/${tenant}`}
          />
        </WorkspaceShell>
      );
    }
    throw error;
  }

  return (
    <WorkspaceShell
      {...shellProps}
      breadcrumb={projectBreadcrumb(
        ctx,
        portfolio.tenantName,
        view.project.name,
        SURFACE_DEFINITIONS["command-center"].label,
      )}
      drawer={
        prov ? <ProvenancePanel closeHref={basePath} ctx={ctx} provenanceId={prov} /> : undefined
      }
    >
      <CommandCenter
        basePath={basePath}
        ctx={ctx}
        lifecycleLabel={lifecycleLabel(view.project.lifecycle)}
        view={view}
      />
    </WorkspaceShell>
  );
}
