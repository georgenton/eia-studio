import { loadCommandCenter, loadPortfolio } from "@eia/application";
import {
  CAPABILITY_CATALOG,
  FeatureDisabled,
  PermissionDenied,
  SURFACE_DEFINITIONS,
} from "@eia/domain";
import { redirect } from "next/navigation";

import { CommandCenter } from "@/components/command-center";
import { ProvenancePanel } from "@/components/provenance-panel";
import { projectBreadcrumb, WorkspaceShell } from "@/components/workspace-shell";
import { getRequestContext, getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { lifecycleLabel } from "@/lib/lifecycle";
import { projectPath } from "@/lib/navigation";
import { getTenantCapabilitySettings } from "@/lib/queries";
import { FeatureDisabledState, PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/**
 * Command Center (design v0.2 §2). Authorization happens here on the server, before any data is
 * read: the context is rebuilt from the URL and verified against memberships, and the read model
 * calls `requireCapability` and `requirePermission`. A hidden rail item is never the control.
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
  const result = await getRequestContext(tenant, project);
  if (result.kind === "unauthenticated") redirect("/sign-in");
  if (result.kind === "denied") {
    return (
      <main style={{ padding: "40px 26px" }}>
        <PermissionDeniedState
          role={result.role}
          restrictedData={result.restrictedData}
          backHref={`/t/${tenant}`}
        />
      </main>
    );
  }
  const { ctx } = result;
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
    if (error instanceof FeatureDisabled) {
      const definition = CAPABILITY_CATALOG[error.capability as keyof typeof CAPABILITY_CATALOG];
      return (
        <WorkspaceShell
          {...shellProps}
          breadcrumb={projectBreadcrumb(ctx, portfolio.tenantName, project, "Command Center")}
        >
          <FeatureDisabledState
            backHref={`/t/${tenant}`}
            capabilityKey={error.capability}
            label={definition?.label ?? error.capability}
            whoCanEnable={error.whoCanEnable}
          />
        </WorkspaceShell>
      );
    }
    if (error instanceof PermissionDenied) {
      return (
        <WorkspaceShell
          {...shellProps}
          breadcrumb={projectBreadcrumb(ctx, portfolio.tenantName, project, "Command Center")}
        >
          <PermissionDeniedState
            role={error.role}
            restrictedData={error.restrictedData}
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
