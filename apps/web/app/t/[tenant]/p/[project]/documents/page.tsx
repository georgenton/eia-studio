import { loadDocuments, loadPortfolio } from "@eia/application";
import { can, SURFACE_DEFINITIONS } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DocumentAssistant } from "@/components/documents/document-assistant";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { projectPath } from "@/lib/navigation";
import { getTenantCapabilitySettings } from "@/lib/queries";
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

  const { ctx } = access;
  const sessionUser = await getSessionUser();
  const tenantSettings = await getTenantCapabilitySettings(ctx);
  const portfolio = await loadPortfolio(getDb(), ctx);

  const shell = {
    ctx,
    tenantSettings,
    projects: portfolio.projects,
    currentSurface: "documents" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? "Usuario",
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      portfolio.tenantName,
      projectLabel(portfolio.projects, project),
      SURFACE_DEFINITIONS.documents.label,
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

  return (
    <WorkspaceShell {...shell}>
      <div className={styles.surface}>
        {assistantEnabled ? <DocumentAssistant tenant={ctx.tenantSlug} project={project} /> : null}

        <Panel>
          <PanelHeader
            label="Documentos del proyecto"
            note={`${documents.length} documento(s) · ${documents.reduce((sum, d) => sum + d.chunkCount, 0)} pasajes`}
          />
          <PanelBody>
            {documents.length === 0 ? (
              <p className={styles.note} data-system-state="empty">
                Este proyecto todavía no tiene documentos cargados. El asistente responde únicamente
                a partir de ellos, así que no tiene nada que consultar.
              </p>
            ) : (
              <table className={styles.table}>
                <caption className="sr-only">Documentos del expediente, por código</caption>
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Documento</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Versión</th>
                    <th scope="col">Páginas</th>
                    <th scope="col">Pasajes</th>
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
                        <div className={styles.strategy}>{document.textSourceLabel}</div>
                      </td>
                      <td>{document.kindLabel}</td>
                      <td className={styles.code}>
                        {document.versionLabel}
                        {document.versionCount > 1 ? ` de ${document.versionCount}` : ""}
                      </td>
                      <td>{document.pageCount}</td>
                      <td>{document.chunkCount}</td>
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
