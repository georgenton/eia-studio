import {
  loadEditorialDraft,
  loadEditorialTenantProfile,
  loadWorkspaceHeader,
} from "@eia/application";
import { can } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { EditorialEditor } from "@/components/portal/editorial-editor";
import { EditorialTenantProfileEditor } from "@/components/portal/editorial-tenant-profile";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { surfaceLabel } from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { projectPath } from "@/lib/navigation";
import { resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

export const dynamic = "force-dynamic";

/**
 * *Presentación pública* — where a firm writes the page the world reads.
 *
 * Three permissions, three different people, and the surface shows each of them only what they
 * may do: `portal.editorial.write` enables the fields and the save button, `portal.preview` opens
 * the page read-only, and `portal.publish` is the one that turns a draft into something public.
 * The buttons are convenience; every act is re-checked in the use-case.
 *
 * ## And a fourth person, who is not an editor at all
 *
 * `portal.profile.manage` is tenant-scoped (OWNER, ADMIN) and names the **firm**, not a road. A
 * tenant ADMIN with no project membership resolves a project for administration — tenant
 * permissions, no project permissions — so the gate below used to deny them, and the one thing
 * they were entitled to do was behind it. They now get a surface with the profile panel and
 * nothing else, and the difference that matters is that `loadEditorialDraft` is **never called**:
 * the draft is not fetched and hidden, it is not fetched. An administrator gains no
 * `portal.preview` and no `portal.editorial.write` from this, and every act is still re-checked
 * in the use-case underneath.
 */
export default async function EditorialPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string }>;
}) {
  const { tenant, project } = await params;
  const access = await resolveSurfaceAccess(tenant, project, "portal");

  if (access.kind === "unauthenticated") redirect("/sign-in");
  if (access.kind === "not-found") notFound();
  if (access.kind === "denied") {
    return (
      <main style={{ padding: "40px 26px" }}>
        <PermissionDeniedState
          backHref={`/t/${tenant}`}
          restrictedData={access.restrictedData}
          role={access.role}
        />
      </main>
    );
  }

  const { ctx, tenantSettings } = access;
  const i18n = await getI18n();
  const { t } = i18n;
  const sessionUser = await getSessionUser();
  const header = await loadWorkspaceHeader(getDb(), ctx);
  const projectName = projectLabel(header.projects, project);

  const shell = {
    ctx,
    tenantSettings,
    projects: header.projects,
    currentSurface: "portal" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? t("shell.user"),
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      header.tenantName,
      projectName,
      `${surfaceLabel(t, "portal")} · ${t("portal.editorial.surface")}`,
      projectPath(ctx.tenantSlug, project, "portal"),
    ),
  };

  const mayWrite = can(ctx, "portal.editorial.write");
  const mayPublish = can(ctx, "portal.publish");
  const mayManageProfile = can(ctx, "portal.profile.manage");
  const mayReadDraft = mayWrite || can(ctx, "portal.preview");

  if (!mayReadDraft && !mayManageProfile) {
    return (
      <WorkspaceShell {...shell}>
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            backHref={projectPath(ctx.tenantSlug, project, "portal")}
            restrictedData={t("portal.editorial.noPermission")}
            role={ctx.projectRole ?? ctx.tenantRole}
          />
        </div>
      </WorkspaceShell>
    );
  }

  const profile = await loadEditorialTenantProfile(getDb(), ctx);

  // Profile only. No draft is read, so there is nothing on this page to hide.
  if (!mayReadDraft) {
    return (
      <WorkspaceShell {...shell}>
        <div style={{ display: "grid", gap: "var(--eia-space-4)" }}>
          <EditorialTenantProfileEditor
            mayManage={mayManageProfile}
            profile={{
              name: profile.name,
              engagementLabel: profile.engagementLabel,
              revision: profile.revision,
            }}
            project={project}
            tenant={tenant}
          />
          <p
            data-testid="editorial-profile-only"
            style={{
              color: "var(--eia-text-muted)",
              fontSize: "var(--eia-size-body)",
              margin: 0,
            }}
          >
            {t("portal.editorial.profileOnly")}
          </p>
        </div>
      </WorkspaceShell>
    );
  }

  const draft = await loadEditorialDraft(getDb(), ctx, projectName);
  const publicUrl = `${getEnv().app.PUBLIC_APP_URL.replace(/\/$/, "")}/p/${tenant}/${project}`;

  return (
    <WorkspaceShell {...shell}>
      <EditorialEditor
        draft={{
          revision: draft.revision,
          payload: draft.payload,
          publishedSequence: draft.publishedSequence,
          publishedAt: draft.publishedAt === null ? null : i18n.fmt.dateTime(draft.publishedAt),
        }}
        mayManageProfile={mayManageProfile}
        mayPublish={mayPublish}
        mayWrite={mayWrite}
        profile={{
          name: profile.name,
          engagementLabel: profile.engagementLabel,
          revision: profile.revision,
        }}
        project={project}
        publicUrl={publicUrl}
        tenant={tenant}
      />
    </WorkspaceShell>
  );
}
