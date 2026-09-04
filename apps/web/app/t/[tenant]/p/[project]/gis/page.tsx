import { loadParcelExplorer, loadPortfolio } from "@eia/application";
import { SURFACE_DEFINITIONS } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { ParcelExplorer } from "@/components/gis/parcel-explorer";
import { ProvenancePanel } from "@/components/provenance-panel";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { projectPath } from "@/lib/navigation";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/**
 * GIS / Parcel Explorer. Access follows the one capability policy (ADR-016): `gis.parcels` must
 * be effective, or the route answers 404 like any URL that means nothing. The read model then
 * re-checks both `gis.maps` and `gis.parcels` plus `parcels.read` before any geometry is read.
 */
export default async function GisPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; project: string }>;
  searchParams: Promise<{ prov?: string }>;
}) {
  const { tenant, project } = await params;
  const { prov } = await searchParams;
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

  const { ctx, tenantSettings } = access;
  const sessionUser = await getSessionUser();
  const portfolio = await loadPortfolio(getDb(), ctx);
  const basePath = projectPath(ctx.tenantSlug, project, "gis");
  const parcelsPath = `/t/${ctx.tenantSlug}/p/${project}/parcels`;

  const shell = {
    ctx,
    tenantSettings,
    projects: portfolio.projects,
    currentSurface: "gis" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? "Usuario",
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      portfolio.tenantName,
      projectLabel(portfolio.projects, project),
      SURFACE_DEFINITIONS.gis.label,
    ),
  };

  let view;
  try {
    view = await loadParcelExplorer(getDb(), ctx);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    if (outcome?.kind === "denied") {
      return (
        <WorkspaceShell {...shell}>
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
      {...shell}
      drawer={
        prov ? <ProvenancePanel closeHref={basePath} ctx={ctx} provenanceId={prov} /> : undefined
      }
    >
      <GisSurface basePath={basePath} parcelsPath={parcelsPath} view={view} />
    </WorkspaceShell>
  );
}

function GisSurface({
  view,
  basePath,
  parcelsPath,
}: {
  view: Awaited<ReturnType<typeof loadParcelExplorer>>;
  basePath: string;
  parcelsPath: string;
}) {
  // `no GIS yet` (system state 9): the project has the capability but no geometry has been loaded.
  if (view.parcels.length === 0) {
    return (
      <div style={{ padding: "24px 0" }}>
        <h1 style={{ fontFamily: "var(--eia-font-serif)", fontSize: 23, margin: 0 }}>
          Este proyecto aún no tiene geometría
        </h1>
        <p style={{ fontSize: 12.5, color: "var(--eia-text-secondary)", maxWidth: 560 }}>
          Carga el eje vial y los predios para activar el explorador. Hasta entonces no se muestran
          capas: no hay cartografía que representar.
        </p>
      </div>
    );
  }
  return <ParcelExplorer basePath={basePath} parcelsPath={parcelsPath} view={view} />;
}
