import { loadPgasPlan, loadPortfolio } from "@eia/application";
import { can, SURFACE_DEFINITIONS } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { PgasOverview } from "@/components/pgas/pgas-overview";
import { ProvenancePanel } from "@/components/provenance-panel";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { projectPath } from "@/lib/navigation";
import { getTenantCapabilitySettings } from "@/lib/queries";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/**
 * The management plan the study proposes.
 *
 * `compliance.pma` gates the route and `documents.read` gates the content: the plan is a chapter of
 * the file, and whoever may read the file may read it. Nothing on this surface records execution —
 * that is a different product with a different capability (ADR-024 §7).
 */
export default async function PgasPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; project: string }>;
  searchParams: Promise<{ prov?: string }>;
}) {
  const { tenant, project } = await params;
  const { prov } = await searchParams;
  const access = await resolveSurfaceAccess(tenant, project, "pgas");

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

  const shell = {
    ctx,
    tenantSettings,
    projects: portfolio.projects,
    currentSurface: "pgas" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? "Usuario",
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      portfolio.tenantName,
      projectLabel(portfolio.projects, project),
      SURFACE_DEFINITIONS.pgas.label,
    ),
  };

  if (!can(ctx, "documents.read")) {
    return (
      <WorkspaceShell {...shell}>
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            role={ctx.projectRole ?? ctx.tenantRole}
            restrictedData="el plan de manejo del expediente"
            backHref={projectPath(ctx.tenantSlug, project, "")}
          />
        </div>
      </WorkspaceShell>
    );
  }

  let view;
  try {
    view = await loadPgasPlan(getDb(), ctx);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    throw error;
  }

  return (
    <WorkspaceShell
      {...shell}
      drawer={
        prov ? (
          <ProvenancePanel
            closeHref={projectPath(ctx.tenantSlug, project, "pgas")}
            ctx={ctx}
            provenanceId={prov}
          />
        ) : undefined
      }
    >
      <PgasOverview view={view} />
    </WorkspaceShell>
  );
}
