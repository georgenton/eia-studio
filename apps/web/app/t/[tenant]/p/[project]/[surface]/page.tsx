import { loadPortfolio } from "@eia/application";
import {
  CAPABILITY_CATALOG,
  FeatureDisabled,
  requireCapability,
  surfaceForSegment,
} from "@eia/domain";
import { ButtonLink, SystemState } from "@eia/ui";
import { notFound, redirect } from "next/navigation";

import { projectBreadcrumb, WorkspaceShell } from "@/components/workspace-shell";
import { getRequestContext, getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getTenantCapabilitySettings } from "@/lib/queries";
import { FeatureDisabledState, PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/**
 * Capability-guarded route for the workspace surfaces this slice does not build yet.
 *
 * It is deliberately NOT a stand-in implementation of those modules: it renders no module data
 * and offers no module actions. What it does is enforce the real authorization contract —
 * `requireCapability` runs server-side, so a disabled or ANNOUNCED capability yields the
 * `feature disabled` state even when the URL is typed by hand and even for an OWNER. Static
 * segments take precedence in the App Router, so each real surface replaces this route when its
 * slice lands.
 */
export default async function SurfacePlaceholderPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string; surface: string }>;
}) {
  const { tenant, project, surface } = await params;
  const definition = surfaceForSegment(surface);
  if (!definition) notFound();

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

  const shell = {
    ctx,
    tenantSettings,
    projects: portfolio.projects,
    currentSurface: definition.key,
    userName: sessionUser?.name ?? sessionUser?.email ?? "Usuario",
    breadcrumb: projectBreadcrumb(ctx, portfolio.tenantName, project, definition.label),
  };

  try {
    requireCapability(ctx, definition.capability);
  } catch (error) {
    if (!(error instanceof FeatureDisabled)) throw error;
    const capability = CAPABILITY_CATALOG[definition.capability];
    return (
      <WorkspaceShell {...shell}>
        <FeatureDisabledState
          backHref={`/t/${tenant}/p/${project}`}
          capabilityKey={definition.capability}
          label={capability.label}
          whoCanEnable={error.whoCanEnable}
        />
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell {...shell}>
      <SystemState
        state="empty"
        title={`${definition.label} llega en ${definition.plannedIn ?? "una fase posterior"}`}
        meta={definition.capability}
      >
        <p>
          El módulo está habilitado para este proyecto, pero su superficie todavía no forma parte
          del producto. No se muestran datos de demostración en su lugar.
        </p>
        <p>
          <ButtonLink href={`/t/${tenant}/p/${project}`} variant="primary">
            Volver al Command Center
          </ButtonLink>
        </p>
      </SystemState>
    </WorkspaceShell>
  );
}
