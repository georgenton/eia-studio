import { loadDocumentVersion, loadWorkspaceHeader } from "@eia/application";
import { can } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { notFound, redirect } from "next/navigation";

import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
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
 * One document version, and the passages a citation can point at.
 *
 * `?v=` selects a specific version, which is how a citation into a superseded one resolves. The
 * page says so rather than redirecting to the current version: the whole reason versions are kept
 * is that an old citation still means what it meant.
 */
export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; project: string; code: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { tenant, project, code } = await params;
  const basePath = `/t/${tenant}/p/${project}/documents/${code}`;
  const { v } = await searchParams;
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
      `${surfaceLabel(t, "documents")} · ${code}`,
      projectPath(ctx.tenantSlug, project, "documents"),
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

  let document;
  try {
    document = await loadDocumentVersion(getDb(), ctx, code, v);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    throw error;
  }

  return (
    <WorkspaceShell {...shell}>
      <div className={styles.surface}>
        <Panel>
          <PanelHeader
            label={`${document.code} ${document.versionLabel} · ${document.title}`}
            note={t("documents.detailNote", {
              kind: documentKindLabel(t, document.kind),
              pages: i18n.fmt.count(document.pageCount),
              passages: i18n.fmt.count(document.chunkCount),
            })}
          />
          <PanelBody>
            {document.superseded ? (
              <p className={styles.superseded}>{t("documents.supersededNote")}</p>
            ) : null}
            {/* Uploaded is not processed, and the version says which it is before it says
                anything else. A reader who takes an unprocessed version for an empty one would
                conclude the document has nothing in it. */}
            {document.processingState === "READY" ? null : (
              <p className={styles.superseded} data-processing-state={document.processingState}>
                <strong>{documentProcessingLabel(t, document.processingState)}.</strong>{" "}
                {document.processingState === "REQUIRES_OCR"
                  ? t("documents.requiresOcrNote")
                  : document.processingState === "FAILED"
                    ? t("documents.processingFailedNote")
                    : document.processingState === "QUEUED"
                      ? t("documents.queuedNote")
                      : document.processingState === "PROCESSING"
                        ? t("documents.processingNote")
                        : t("documents.notProcessedYet")}
                {/* Operator-facing and bounded: it names the *kind* of failure, or — for a scan —
                    the numbers behind the verdict. Never the document's text (ADR-033). */}
                {document.processingNote === null ? null : (
                  <span className={styles.strategy}> {document.processingNote}</span>
                )}
              </p>
            )}
            <p className={styles.note}>
              <strong>{textSourceLabel(t, document.textSource)}.</strong> {document.sourceNote}
            </p>
            {/* The original file, behind a link the server mints one at a time after re-checking
                `documents.read` and auditing the issuance (ADR-034). A version with no stored
                object is a transcribed excerpt, and says so rather than offering a dead button. */}
            <p className={styles.strategy}>
              {document.storedObjectId === null ? (
                t("documents.noOriginal")
              ) : (
                <>
                  <a className={styles.docLink} href={`${basePath}/download/${document.versionId}`}>
                    {t("documents.download")}
                  </a>{" "}
                  · {t("documents.downloadNote")}
                </>
              )}
            </p>
            <p className={styles.strategy}>
              {t("documents.privacy")}: {documentPrivacyLabel(t, document.privacyClassification)}
              {document.originalFilename === null ? null : (
                <>
                  {" · "}
                  {t("documents.originalFilename")}: <code>{document.originalFilename}</code>
                </>
              )}
              {document.sizeBytes === null
                ? null
                : ` · ${t("documents.fileSize")}: ${i18n.fmt.bytes(document.sizeBytes)}`}
            </p>
            <p className={styles.strategy}>
              {t("documents.chunkingStrategy")} <code>{document.chunkingStrategy}</code>.{" "}
              {t("documents.chunkingNote")}
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader label={t("documents.passages")} note={t("documents.passagesNote")} />
          <PanelBody>
            <ol className={styles.passages}>
              {document.passages.map((passage) => (
                <li className={styles.passage} key={passage.chunkId} id={`p-${passage.ordinal}`}>
                  <span className={styles.passageMeta}>
                    {t("documents.passage", { number: i18n.fmt.count(passage.ordinal + 1) })}
                    {/* What a citation names, and it is not always a page: a DOCX has no page
                        model this product could know, so its passages carry the heading trail
                        instead of a number nobody could check (ADR-033). */}
                    {passage.locatorKind === "SECTION"
                      ? passage.sectionPath === null
                        ? ""
                        : t("documents.passageSection", { section: passage.sectionPath })
                      : passage.pageFrom === null || passage.pageTo === null
                        ? ""
                        : passage.pageFrom === passage.pageTo
                          ? t("documents.passagePage", { page: i18n.fmt.count(passage.pageFrom) })
                          : t("documents.passagePages", {
                              from: i18n.fmt.count(passage.pageFrom),
                              to: i18n.fmt.count(passage.pageTo),
                            })}
                  </span>
                  <p className={styles.passageText}>{passage.text}</p>
                </li>
              ))}
            </ol>
          </PanelBody>
        </Panel>
      </div>
    </WorkspaceShell>
  );
}
