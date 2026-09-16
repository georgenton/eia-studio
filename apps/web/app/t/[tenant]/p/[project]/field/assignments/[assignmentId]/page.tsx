import { loadAssignmentDetail, loadWorkspaceHeader } from "@eia/application";
import { ASSIGNMENT_STATUS_PRESENTATION, formatChainage } from "@eia/domain";
import { Chip } from "@eia/ui";
import { notFound, redirect } from "next/navigation";

import { SurveyForm } from "@/components/field/survey-form";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { assignmentStatusLabel, instanceStatusLabel, surfaceLabel } from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { projectPath } from "@/lib/navigation";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

import styles from "./assignment.module.css";

export const dynamic = "force-dynamic";

/**
 * One assignment: the parcel it is about, the visit, and the questionnaire.
 *
 * An assignment that is not the caller's own answers **404**, not a denial. A distinguishable
 * error would confirm the assignment exists, which is precisely what someone editing ids in the
 * address bar wants to learn. `loadAssignmentDetail` raises `NotFound` and the RLS policy has
 * already refused the row.
 */
export default async function AssignmentPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string; assignmentId: string }>;
}) {
  const { tenant, project, assignmentId } = await params;
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
  const i18n = await getI18n();
  const { t } = i18n;
  const sessionUser = await getSessionUser();
  const header = await loadWorkspaceHeader(getDb(), ctx);
  const fieldPath = projectPath(ctx.tenantSlug, project, "field");

  let detail;
  try {
    detail = await loadAssignmentDetail(getDb(), ctx, assignmentId);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    if (outcome?.kind === "denied") notFound();
    throw error;
  }

  return (
    <WorkspaceShell
      ctx={ctx}
      tenantSettings={tenantSettings}
      projects={header.projects}
      currentSurface="field"
      userName={sessionUser?.name ?? sessionUser?.email ?? t("shell.user")}
      userEmail={sessionUser?.email ?? null}
      breadcrumb={[
        ...projectBreadcrumb(
          ctx,
          header.tenantName,
          projectLabel(header.projects, project),
          surfaceLabel(t, "field"),
          fieldPath,
        ),
        { label: detail.assignment.parcelCode },
      ]}
    >
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.code}>{detail.assignment.parcelCode}</h1>
            {/* Parcel context, by code and position. Never an owner's name: an assignment is
                addressed by where it is, not by who lives there. */}
            <p className={styles.context}>
              {detail.assignment.sectorLabel ?? t("gis.noSector")}
              {detail.assignment.chainageM === null
                ? ""
                : ` · ${t("gis.chainageAbbrev")} ${formatChainage(detail.assignment.chainageM)}`}
            </p>
          </div>
          <div className={styles.badges}>
            <Chip tone={detail.assignment.status === "COMPLETED" ? "ok" : "neutral"}>
              <span aria-hidden="true">
                {ASSIGNMENT_STATUS_PRESENTATION[detail.assignment.status].glyph}
              </span>{" "}
              {assignmentStatusLabel(t, detail.assignment.status)}
            </Chip>
            {detail.assignment.instanceStatus ? (
              <Chip tone={detail.assignment.instanceStatus === "SUBMITTED" ? "ok" : "neutral"}>
                {instanceStatusLabel(t, detail.assignment.instanceStatus)}
              </Chip>
            ) : null}
          </div>
        </header>

        <SurveyForm
          backHref={fieldPath}
          detail={detail}
          locale={i18n.locale}
          project={project}
          tenant={ctx.tenantSlug}
        />
      </div>
    </WorkspaceShell>
  );
}
