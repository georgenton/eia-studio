import { loadDocuments, loadWorkspaceHeader } from "@eia/application";
import { can } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DocumentAssistant } from "@/components/documents/document-assistant";
import { DocumentUpload } from "@/components/documents/document-upload";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  documentKindLabel,
  documentPrivacyLabel,
  documentProcessingLabel,
  surfaceLabel,
  textSourceLabel,
} from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { projectPath } from "@/lib/navigation";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

import styles from "@/components/documents/documents.module.css";

export const dynamic = "force-dynamic";

/**
 * Documents, and the assistant that answers from them.
 *
 * `core.documents` gates the route; `documents.read` gates the list. The assistant is a separate
 * capability (`quality.rag_assistant`) on the same page: a project may hold its documents without
 * enabling the assistant, and the page still works.
 */
export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string }>;
}) {
  const { tenant, project } = await params;
  const access = await resolveSurfaceAccess(tenant, project, "documents");

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
    currentSurface: "documents" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? t("shell.user"),
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      header.tenantName,
      projectLabel(header.projects, project),
      surfaceLabel(t, "documents"),
    ),
  };

  if (!can(ctx, "documents.read")) {
    return (
      <WorkspaceShell {...shell}>
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            role={ctx.projectRole ?? ctx.tenantRole}
            restrictedData="los documentos del expediente"
            backHref={projectPath(ctx.tenantSlug, project, "")}
          />
        </div>
      </WorkspaceShell>
    );
  }

  let documents;
  try {
    documents = await loadDocuments(getDb(), ctx);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    throw error;
  }

  const assistantEnabled = ctx.capabilities["quality.rag_assistant"] === true;
  // Two independent questions, deliberately not collapsed into one: *may this person add a file*
  // is a permission, and *can this deployment store one* is configuration. Answering the second
  // with a denial would blame the reader for the environment (ADR-031).
  const mayUpload = can(ctx, "documents.write");
  const storage = getEnv().storage;

  return (
    <WorkspaceShell {...shell}>
      <div className={styles.surface}>
        {assistantEnabled ? <DocumentAssistant tenant={ctx.tenantSlug} project={project} /> : null}

        {/* A link rather than a section: an AI candidate and a rule's finding must never share a
            list, and they must not share a scroll either (ADR-035 §4). */}
        {assistantEnabled ? (
          <p className={styles.note}>
            <Link
              className={styles.docLink}
              href={`/t/${ctx.tenantSlug}/p/${project}/documents/review`}
            >
              {t("documents.review.title")}
            </Link>{" "}
            — {t("documents.review.lead")}
          </p>
        ) : null}

        {mayUpload && storage.state === "AVAILABLE" ? (
          <DocumentUpload
            documents={documents.map((document) => ({
              id: document.id,
              code: document.code,
              title: document.title,
            }))}
            project={project}
            tenant={ctx.tenantSlug}
          />
        ) : null}
        {mayUpload && storage.state !== "AVAILABLE" ? (
          <Panel>
            <PanelHeader label={t("documents.uploadTitle")} />
            <PanelBody>
              {/* The operator-facing `detail` names variables and stays in the logs; what a
                  consultant reads is that uploading is off here and who turns it on. */}
              <p className={styles.note} data-system-state="feature disabled">
                {t("documents.storageUnavailable")}
              </p>
              <p className={styles.note}>{t("documents.storageUnavailableWho")}</p>
            </PanelBody>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader
            label={t("documents.projectDocuments")}
            note={t("documents.documentsNote", {
              documents: i18n.fmt.count(documents.length),
              passages: i18n.fmt.count(documents.reduce((sum, d) => sum + d.chunkCount, 0)),
            })}
          />
          <PanelBody>
            {documents.length === 0 ? (
              <p className={styles.note} data-system-state="empty">
                {t("documents.emptyBody")}
              </p>
            ) : (
              <table className={styles.table}>
                <caption className="sr-only">{t("documents.tableCaption")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("documents.code")}</th>
                    <th scope="col">{t("documents.document")}</th>
                    <th scope="col">{t("documents.kind")}</th>
                    <th scope="col">{t("common.version")}</th>
                    <th scope="col">{t("documents.state")}</th>
                    <th scope="col">{t("documents.pages")}</th>
                    <th scope="col">{t("documents.passages")}</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => (
                    <tr key={document.id}>
                      <td className={styles.code}>
                        <Link
                          className={styles.docLink}
                          href={`/t/${ctx.tenantSlug}/p/${project}/documents/${document.code}`}
                        >
                          {document.code}
                        </Link>
                      </td>
                      <td>
                        {document.title}
                        <div className={styles.strategy}>
                          {textSourceLabel(t, document.textSource)}
                        </div>
                      </td>
                      <td>{documentKindLabel(t, document.kind)}</td>
                      <td className={styles.code}>
                        {document.versionLabel}
                        {document.versionCount > 1
                          ? t("documents.ofVersions", {
                              count: i18n.fmt.count(document.versionCount),
                            })
                          : ""}
                      </td>
                      <td className={styles.stateCell}>
                        {documentProcessingLabel(t, document.processingState)}
                        {/* The privacy classification is a claim the uploader made, so it is shown
                            wherever the version is, not filed away in a detail page. */}
                        {document.privacyClassification === "NO_PERSONAL_DATA_KNOWN" ? null : (
                          <span className={styles.privacyFlag}>
                            {t("documents.privacy")}:{" "}
                            {documentPrivacyLabel(t, document.privacyClassification)}
                          </span>
                        )}
                      </td>
                      <td>{i18n.fmt.count(document.pageCount)}</td>
                      <td>{i18n.fmt.count(document.chunkCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </PanelBody>
        </Panel>
      </div>
    </WorkspaceShell>
  );
}
