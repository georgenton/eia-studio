import { listGeneratedDocuments, listReportTemplates, loadWorkspaceHeader } from "@eia/application";
import { can, PLACEHOLDERS } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { TemplateLibrary } from "@/components/templates/template-library";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  surfaceLabel,
  templateAbsenceLabel,
  templateLocaleLabel,
  templateSourceLabel,
} from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { projectPath } from "@/lib/navigation";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

import styles from "@/components/templates/templates.module.css";

export const dynamic = "force-dynamic";

/**
 * The template library (ADR-036).
 *
 * The page exists to make three things visible before anybody produces a deliverable: which
 * placeholders this product is willing to substitute, which of them a given template uses, and
 * which tags it uses that nobody declared — because that last list is what stops an activation,
 * and a template's errors belong to a person rather than to a silently blank paragraph.
 */
export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string }>;
}) {
  const { tenant, project } = await params;
  const access = await resolveSurfaceAccess(tenant, project, "reports");

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

  const shell = {
    ctx,
    tenantSettings,
    projects: header.projects,
    currentSurface: "reports" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? t("shell.user"),
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      header.tenantName,
      projectLabel(header.projects, project),
      `${surfaceLabel(t, "reports")} · ${t("templates.title")}`,
    ),
  };

  if (!can(ctx, "reports.write")) {
    return (
      <WorkspaceShell {...shell}>
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            role={ctx.projectRole ?? ctx.tenantRole}
            restrictedData={t("templates.title")}
            backHref={projectPath(ctx.tenantSlug, project, "reports")}
          />
        </div>
      </WorkspaceShell>
    );
  }

  let templates;
  let generated;
  try {
    [templates, generated] = await Promise.all([
      listReportTemplates(getDb(), ctx),
      listGeneratedDocuments(getDb(), ctx),
    ]);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    throw error;
  }

  const storage = getEnv().storage;
  const basePath = `/t/${ctx.tenantSlug}/p/${project}/reports/templates`;

  return (
    <WorkspaceShell {...shell}>
      <div className={styles.surface}>
        <p className={styles.note}>
          <Link className={styles.docLink} href={projectPath(ctx.tenantSlug, project, "reports")}>
            {t("reports.title")}
          </Link>
        </p>

        {storage.state === "AVAILABLE" ? null : (
          <Panel>
            <PanelHeader label={t("templates.title")} note={t("templates.lead")} />
            <PanelBody>
              <p className={styles.note} data-system-state="feature disabled">
                {t("templates.storageUnavailable")}
              </p>
            </PanelBody>
          </Panel>
        )}

        <TemplateLibrary
          canUpload={storage.state === "AVAILABLE"}
          project={project}
          templates={templates.map((template) => ({
            id: template.id,
            code: template.code,
            name: template.name,
            kind: template.kind,
            purpose: template.purpose,
            versions: template.versions.map((version) => ({
              id: version.id,
              versionLabel: version.versionLabel,
              locale: version.locale,
              state: version.state,
              supported: version.manifest?.supported ?? [],
              unknown: version.manifest?.unknown ?? [],
              required: version.manifest?.required ?? [],
              tagCount: version.manifest?.tagCount ?? 0,
              validationError: version.validationError,
            })),
          }))}
          tenant={ctx.tenantSlug}
        />

        <Panel>
          <PanelHeader label={t("templates.generatedTitle")} note={t("templates.generatedLead")} />
          <PanelBody>
            {generated.length === 0 ? (
              <p className={styles.note} data-system-state="empty">
                {t("templates.noGenerated")}
              </p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t("templates.generatedTemplate")}</th>
                    <th scope="col">{t("templates.locale")}</th>
                    <th scope="col">{t("templates.generatedAt")}</th>
                    <th scope="col">{t("templates.generatedAbsent")}</th>
                    <th scope="col">{t("templates.download")}</th>
                  </tr>
                </thead>
                <tbody>
                  {generated.map((document) => (
                    <tr key={document.id} data-testid="generated-document">
                      <td className={styles.code}>
                        {document.templateCode} {document.templateVersionLabel}
                      </td>
                      <td>{templateLocaleLabel(t, document.locale)}</td>
                      <td>{i18n.fmt.dateTime(document.generatedAt)}</td>
                      {/* Recorded rather than inferred: a reader can tell a blank the project
                          genuinely had from one a later change created. */}
                      <td>
                        {document.declaredAbsent.length === 0
                          ? "—"
                          : document.declaredAbsent.join(", ")}
                      </td>
                      <td>
                        <a className={styles.docLink} href={`${basePath}/download/${document.id}`}>
                          {t("templates.download")}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className={styles.note}>{t("templates.generatedAbsentNote")}</p>
            <p className={styles.note}>{t("templates.downloadNote")}</p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            label={t("templates.vocabularyTitle")}
            note={t("templates.vocabularyLead")}
          />
          <PanelBody>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("templates.vocabularyKey")}</th>
                  <th scope="col">{t("templates.vocabularySource")}</th>
                  <th scope="col">{t("templates.vocabularyAbsence")}</th>
                </tr>
              </thead>
              <tbody>
                {PLACEHOLDERS.map((placeholder) => (
                  <tr key={placeholder.key}>
                    <td className={styles.code}>{`{{${placeholder.key}}}`}</td>
                    <td>{templateSourceLabel(t, placeholder.key)}</td>
                    <td>{templateAbsenceLabel(t, placeholder.absence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PanelBody>
        </Panel>
      </div>
    </WorkspaceShell>
  );
}
