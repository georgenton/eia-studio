import {
  loadParcelMedia,
  loadParcelVisits,
  loadParcelWorkspace,
  loadWorkspaceHeader,
} from "@eia/application";
import { can } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { isParcelTab, ParcelWorkspace } from "@/components/gis/parcel-workspace";
import { ProvenancePanel } from "@/components/provenance-panel";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { surfaceLabel } from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { projectPath } from "@/lib/navigation";
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

  const { ctx, tenantSettings } = access;
  const i18n = await getI18n();
  const { t } = i18n;
  const sessionUser = await getSessionUser();
  const header = await loadWorkspaceHeader(getDb(), ctx);
  const explorerPath = projectPath(ctx.tenantSlug, project, "gis");
  const basePath = `/t/${ctx.tenantSlug}/p/${project}/parcels/${encodeURIComponent(parcelCode)}`;
  const tab = isParcelTab(rawTab) ? rawTab : "resumen";

  const shell = {
    ctx,
    tenantSettings,
    projects: header.projects,
    currentSurface: "gis" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? t("shell.user"),
    userEmail: sessionUser?.email ?? null,
    breadcrumb: [
      ...projectBreadcrumb(
        ctx,
        header.tenantName,
        projectLabel(header.projects, project),
        surfaceLabel(t, "gis"),
        explorerPath,
      ),
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

  // The Visits tab is a *field* read model, gated by its own capability and permission: opening a
  // parcel does not entitle anyone to the field work recorded against it.
  const seesField = ctx.capabilities["field.surveys"] === true && can(ctx, "parcels.read");
  const visits = seesField ? await loadParcelVisits(getDb(), ctx, view.parcel.id) : null;
  // A photograph of a parcel can hold a person, a house number or a number plate, so it sits
  // behind `field.responses.read` rather than behind parcel access (ADR-032, SECURITY.md §10b).
  // The row-level policy says the same thing again underneath.
  const media =
    seesField && can(ctx, "field.responses.read")
      ? await loadParcelMedia(getDb(), ctx, view.parcel.id)
      : null;

  return (
    <WorkspaceShell
      {...shell}
      drawer={
        prov ? (
          <ProvenancePanel closeHref={`${basePath}?tab=${tab}`} ctx={ctx} provenanceId={prov} />
        ) : undefined
      }
    >
      <ParcelWorkspace
        basePath={basePath}
        canReadResponses={can(ctx, "field.responses.read")}
        explorerPath={explorerPath}
        i18n={i18n}
        tab={tab}
        view={view}
        media={media}
        visits={visits}
      />
    </WorkspaceShell>
  );
}
