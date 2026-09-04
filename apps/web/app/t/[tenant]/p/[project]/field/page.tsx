import { loadFieldOverview, loadMyWork, loadPortfolio } from "@eia/application";
import { can, readFieldOfflineMode, SURFACE_DEFINITIONS } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { FieldOverviewSurface } from "@/components/field/field-overview";
import { MyWork } from "@/components/field/my-work";
import { ProvenancePanel } from "@/components/provenance-panel";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { projectPath } from "@/lib/navigation";
import { getProjectConfiguration } from "@/lib/queries";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/**
 * FieldFlow. One route, two surfaces, chosen by what the caller may actually do rather than by a
 * role name: a caller with `field.read` gets the campaign overview, a technician with only
 * `field.assignments.read_own` gets their own work. The permission decides, so a future role with
 * the same grants gets the right screen without this file changing.
 */
export default async function FieldPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; project: string }>;
  searchParams: Promise<{ prov?: string }>;
}) {
  const { tenant, project } = await params;
  const { prov } = await searchParams;
  const access = await resolveSurfaceAccess(tenant, project, "field");

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
  const basePath = projectPath(ctx.tenantSlug, project, "field");

  const shell = {
    ctx,
    tenantSettings,
    projects: portfolio.projects,
    currentSurface: "field" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? "Usuario",
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      portfolio.tenantName,
      projectLabel(portfolio.projects, project),
      SURFACE_DEFINITIONS.field.label,
    ),
    drawer: prov ? (
      <ProvenancePanel closeHref={basePath} ctx={ctx} provenanceId={prov} />
    ) : undefined,
  };

  const seesOverview = can(ctx, "field.read");
  const seesOwnWork = can(ctx, "field.assignments.read_own");

  if (!seesOverview && !seesOwnWork) {
    return (
      <WorkspaceShell {...shell}>
        <PermissionDeniedState
          role={ctx.projectRole ?? ctx.tenantRole}
          restrictedData="field.read"
          backHref={`/t/${tenant}`}
        />
      </WorkspaceShell>
    );
  }

  // Data first, JSX after: constructing elements inside a try/catch does not catch their render
  // errors anyway, and separating the two makes the failure path explicit.
  let overview: Awaited<ReturnType<typeof loadFieldOverview>> | null = null;
  let assignments: Awaited<ReturnType<typeof loadMyWork>> | null = null;
  let offlineMode = readFieldOfflineMode(null);
  let denial: { role: string | null; restrictedData: string } | null = null;

  try {
    if (seesOverview) {
      overview = await loadFieldOverview(getDb(), ctx);
      offlineMode = readFieldOfflineMode(await getProjectConfiguration(ctx));
    } else {
      assignments = await loadMyWork(getDb(), ctx);
    }
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    if (outcome?.kind === "denied") {
      denial = { role: outcome.role, restrictedData: outcome.restrictedData };
    } else {
      throw error;
    }
  }

  return (
    <WorkspaceShell {...shell}>
      {denial ? (
        <PermissionDeniedState
          role={denial.role}
          restrictedData={denial.restrictedData}
          backHref={`/t/${tenant}`}
        />
      ) : overview ? (
        <FieldOverviewSurface basePath={basePath} offlineMode={offlineMode} overview={overview} />
      ) : (
        <MyWork
          assignments={assignments ?? []}
          assignmentPath={(assignmentId) => `${basePath}/assignments/${assignmentId}`}
        />
      )}
    </WorkspaceShell>
  );
}
