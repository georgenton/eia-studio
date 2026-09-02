import { loadParcelWorkspace, loadPortfolio } from "@eia/application";
import { notFound, redirect } from "next/navigation";

import { isParcelTab, ParcelWorkspace } from "@/components/gis/parcel-workspace";
import { ProvenancePanel } from "@/components/provenance-panel";
import { projectBreadcrumb, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { projectPath } from "@/lib/navigation";
import { getTenantCapabilitySettings } from "@/lib/queries";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/**
 * Parcel Workspace. It lives under the same `gis.parcels` capability as the Explorer, so an
 * unauthorized or disabled project answers 404 here too: a parcel code must not be probeable.
 */
export default async function ParcelWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; project: string; parcelCode: string }>;
  searchParams: Promise<{ tab?: string; prov?: string }>;
}) {
  const { tenant, project, parcelCode: rawParcelCode } = await params;
  const { tab: rawTab, prov } = await searchParams;
  const parcelCode = decodeURIComponent(rawParcelCode);
  const access = await resolveSurfaceAccess(tenant, project, "gis");

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
  const explorerPath = projectPath(ctx.tenantSlug, project, "gis");
  const basePath = `/t/${ctx.tenantSlug}/p/${project}/parcels/${encodeURIComponent(parcelCode)}`;
  const tab = isParcelTab(rawTab) ? rawTab : "resumen";

  const shell = {
    ctx,
    tenantSettings,
    projects: portfolio.projects,
    currentSurface: "gis" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? "Usuario",
    breadcrumb: [
      ...projectBreadcrumb(ctx, portfolio.tenantName, project, "GIS & Predios", explorerPath),
      { label: parcelCode },
    ],
  };

  let view;
  try {
    view = await loadParcelWorkspace(getDb(), ctx, parcelCode);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    if (outcome?.kind === "denied") {
      return (
        <WorkspaceShell {...shell}>
          <PermissionDeniedState
            role={outcome.role}
            restrictedData={outcome.restrictedData}
            backHref={explorerPath}
          />
        </WorkspaceShell>
      );
    }
    throw error;
  }

  return (
    <WorkspaceShell
      {...shell}
      drawer={
        prov ? (
          <ProvenancePanel closeHref={`${basePath}?tab=${tab}`} ctx={ctx} provenanceId={prov} />
        ) : undefined
      }
    >
      <ParcelWorkspace basePath={basePath} explorerPath={explorerPath} tab={tab} view={view} />
    </WorkspaceShell>
  );
}
