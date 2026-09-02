import { loadPortfolio } from "@eia/application";
import { notFound, redirect } from "next/navigation";

import { projectBreadcrumb, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getTenantCapabilitySettings } from "@/lib/queries";
import { resolveSurfaceAccessBySegment } from "@/lib/surface-access";
import { ModuleNotImplementedState, PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/**
 * Route for the workspace surfaces this slice does not build yet.
 *
 * It implements no module: no module data, no module actions. What it does is answer the one
 * capability policy (ADR-016) — an ineffective capability is 404, an effective one whose surface
 * is missing gets an explicit inert state. Static segments take precedence in the App Router, so
 * each real surface replaces this route when its slice lands.
 */
export default async function SurfacePage({
  params,
}: {
  params: Promise<{ tenant: string; project: string; surface: string }>;
}) {
  const { tenant, project, surface } = await params;
  const access = await resolveSurfaceAccessBySegment(tenant, project, surface);

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

  // `ok` cannot occur here: an implemented surface has its own static route, which wins.
  const { ctx, surface: definition } = access;
  const sessionUser = await getSessionUser();
  const tenantSettings = await getTenantCapabilitySettings(ctx);
  const portfolio = await loadPortfolio(getDb(), ctx);

  return (
    <WorkspaceShell
      breadcrumb={projectBreadcrumb(ctx, portfolio.tenantName, project, definition.label)}
      ctx={ctx}
      currentSurface={definition.key}
      projects={portfolio.projects}
      tenantSettings={tenantSettings}
      userName={sessionUser?.name ?? sessionUser?.email ?? "Usuario"}
    >
      <ModuleNotImplementedState
        backHref={`/t/${tenant}/p/${project}`}
        capabilityKey={definition.capability}
        label={definition.label}
        plannedIn={definition.plannedIn}
      />
    </WorkspaceShell>
  );
}
