import {
  loadCommandCenter,
  loadFieldProgress,
  loadWorkspaceHeader,
  loadTerritorialSummary,
} from "@eia/application";
import { can, SURFACE_DEFINITIONS } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { CommandCenter } from "@/components/command-center";
import { ProvenancePanel } from "@/components/provenance-panel";
import { projectBreadcrumb, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { surfaceLabel } from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { projectPath } from "@/lib/navigation";
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

  const { ctx, tenantSettings } = access;
  const i18n = await getI18n();
  const { t } = i18n;
  const sessionUser = await getSessionUser();
  const header = await loadWorkspaceHeader(getDb(), ctx);
  const basePath = projectPath(ctx.tenantSlug, project, "");

  const shellProps = {
    ctx,
    tenantSettings,
    projects: header.projects,
    currentSurface: "command-center" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? t("shell.user"),
    userEmail: sessionUser?.email ?? null,
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
          breadcrumb={projectBreadcrumb(
            ctx,
            header.tenantName,
            project,
            surfaceLabel(t, "command-center"),
          )}
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

  // The territorial summary is a GIS read model, gated by its own capability: the Command Center
  // composes it rather than reaching into another module's tables (TD-023, GIS portion).
  const gisSurface = SURFACE_DEFINITIONS.gis;
  const gisEnabled = ctx.capabilities[gisSurface.capability];
  const territory = gisEnabled ? await loadTerritorialSummary(getDb(), ctx) : null;
  const gisPath =
    gisEnabled && gisSurface.implemented
      ? projectPath(ctx.tenantSlug, project, gisSurface.segment)
      : null;

  // Field progress is a FieldFlow read model with its own capability and permission: the Command
  // Center composes it rather than reaching into another module's tables.
  const fieldSurface = SURFACE_DEFINITIONS.field;
  const fieldEnabled = ctx.capabilities[fieldSurface.capability] && can(ctx, "field.read");
  const fieldProgress = fieldEnabled ? await loadFieldProgress(getDb(), ctx) : null;
  const fieldPath =
    fieldEnabled && fieldSurface.implemented
      ? projectPath(ctx.tenantSlug, project, fieldSurface.segment)
      : null;

  return (
    <WorkspaceShell
      {...shellProps}
      breadcrumb={projectBreadcrumb(
        ctx,
        header.tenantName,
        view.project.name,
        surfaceLabel(t, "command-center"),
      )}
      drawer={
        prov ? <ProvenancePanel closeHref={basePath} ctx={ctx} provenanceId={prov} /> : undefined
      }
    >
      <CommandCenter
        basePath={basePath}
        ctx={ctx}
        fieldPath={fieldPath}
        fieldProgress={fieldProgress}
        gisPath={gisPath}
        i18n={i18n}
        lifecycleLabel={t(
          `vocabulary.lifecycle.${view.project.lifecycle}` as Parameters<typeof t>[0],
        )}
        territory={territory}
        view={view}
      />
    </WorkspaceShell>
  );
}
