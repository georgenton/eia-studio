import { loadDocumentVersion, loadPortfolio } from "@eia/application";
import { can, SURFACE_DEFINITIONS } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import { notFound, redirect } from "next/navigation";

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
      `${SURFACE_DEFINITIONS.documents.label} · ${code}`,
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
            note={`${document.kindLabel} · ${document.pageCount} página(s) · ${document.chunkCount} pasajes`}
          />
          <PanelBody>
            {document.superseded ? (
              <p className={styles.superseded}>
                Esta es una versión anterior del documento. Se conserva porque las citas hechas
                contra ella siguen apuntando a estas palabras; la versión vigente puede decir otra
                cosa.
              </p>
            ) : null}
            <p className={styles.note}>
              <strong>{document.textSourceLabel}.</strong> {document.sourceNote}
            </p>
            <p className={styles.strategy}>
              Segmentación <code>{document.chunkingStrategy}</code>. Los pasajes son la unidad que
              una cita nombra; no cambian mientras exista esta versión.
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader label="Pasajes" note="En el orden en que aparecen en el documento" />
          <PanelBody>
            <ol className={styles.passages}>
              {document.passages.map((passage) => (
                <li className={styles.passage} key={passage.chunkId} id={`p-${passage.ordinal}`}>
                  <span className={styles.passageMeta}>
                    Pasaje {passage.ordinal + 1}
                    {passage.pageFrom === passage.pageTo
                      ? ` · p. ${passage.pageFrom}`
                      : ` · pp. ${passage.pageFrom}–${passage.pageTo}`}
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
