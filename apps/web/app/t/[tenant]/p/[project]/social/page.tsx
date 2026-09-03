import {
  loadDistributions,
  loadOpenQuestion,
  loadOpenResponses,
  loadPortfolio,
  loadPublishedTaxonomy,
  loadRuns,
  loadSocialMetrics,
  loadSocialVersions,
  loadTabulation,
} from "@eia/application";
import { can, SURFACE_DEFINITIONS } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { OpenResponseQueue } from "@/components/social/open-response-queue";
import { SocialOverview } from "@/components/social/social-overview";
import { TabulationPanel } from "@/components/social/tabulation-panel";
import { projectBreadcrumb, WorkspaceShell } from "@/components/workspace-shell";
import { aiStatusFor } from "@/lib/ai-status";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { projectPath } from "@/lib/navigation";
import { getTenantCapabilitySettings } from "@/lib/queries";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

import styles from "@/components/social/social.module.css";

export const dynamic = "force-dynamic";

/**
 * Social Intelligence.
 *
 * The surface is organised around the product's central distinction rather than around the data
 * model: **Tabulación** is what the rules calculate, **Respuestas abiertas** is what a model
 * proposes and a specialist decides. They are separate tabs because they are separate kinds of
 * claim, and a reader should never have to work out which one a figure came from.
 *
 * Capability and permission do different jobs here, visibly:
 *
 * - `social.analytics` gates the whole route (404 when ineffective, ADR-016);
 * - `social.ai_coding` gates the coding half only — with it off, tabulation still works, because
 *   deterministic analytics do not depend on a model being available;
 * - `field.responses.read` gates the individual open-response text, reusing the boundary that
 *   already governs the answers themselves rather than inventing a parallel one.
 */
export default async function SocialPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; project: string }>;
  searchParams: Promise<{ tab?: string; version?: string }>;
}) {
  const { tenant, project } = await params;
  const { tab, version } = await searchParams;
  const access = await resolveSurfaceAccess(tenant, project, "social");

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
    currentSurface: "social" as const,
    userName: sessionUser?.name ?? sessionUser?.email ?? "Usuario",
    userEmail: sessionUser?.email ?? null,
    breadcrumb: projectBreadcrumb(
      ctx,
      portfolio.tenantName,
      project,
      SURFACE_DEFINITIONS.social.label,
    ),
  };

  // Every figure on this surface is counted from response rows under row level security, so a
  // caller without `field.responses.read` would be shown zeros rather than data. Denying is the
  // honest outcome; the aggregate projection that would let a viewer see real totals without
  // seeing rows is recorded as TD-045.
  if (!can(ctx, "field.responses.read")) {
    return (
      <WorkspaceShell {...shell}>
        {/* Inside the shell, so the denial keeps its navigation — and not wrapped in a second
            <main>, because the shell already provides the one landmark this page has. */}
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            role={ctx.projectRole ?? ctx.tenantRole}
            restrictedData="las respuestas individuales de campo"
            backHref={projectPath(ctx.tenantSlug, project, "")}
          />
        </div>
      </WorkspaceShell>
    );
  }

  let versions;
  try {
    versions = await loadSocialVersions(getDb(), ctx);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    throw error;
  }

  const withResponses = versions.filter((option) => option.submitted > 0);
  if (withResponses.length === 0) {
    return (
      <WorkspaceShell {...shell}>
        <div className={styles.surface}>
          <p className={styles.note} data-system-state="no-survey-data">
            Todavía no hay respuestas enviadas que tabular. Social Intelligence lee únicamente
            respuestas <strong>enviadas</strong>: los borradores de campo no participan en ninguna
            cifra de esta superficie.
          </p>
        </div>
      </WorkspaceShell>
    );
  }

  const selected =
    withResponses.find((option) => option.versionId === version) ?? withResponses[0]!;
  const activeTab = tab === "abiertas" ? "abiertas" : "tabulacion";

  const tabulation = await loadTabulation(getDb(), ctx, selected.versionId);
  const aiEnabled = ctx.capabilities["social.ai_coding"] === true;

  // The coding half needs its own capability. With `social.ai_coding` off, the deterministic
  // tabulation still works: analytics do not depend on a model being available.
  const coding = aiEnabled
    ? {
        metrics: await loadSocialMetrics(getDb(), ctx, selected.versionId),
        distributions: await loadDistributions(getDb(), ctx, selected.versionId),
        taxonomy: await loadPublishedTaxonomy(getDb(), ctx),
        runs: await loadRuns(getDb(), ctx),
        responses: await loadOpenResponses(getDb(), ctx, {
          surveyVersionId: selected.versionId,
        }),
      }
    : null;

  // The question a run codes: the version's open-text question, resolved server-side. A client
  // that could name the question could point a run at a different one than the queue shows.
  const openQuestionId = coding ? await loadOpenQuestion(getDb(), ctx, selected.versionId) : null;

  return (
    <WorkspaceShell {...shell}>
      <div className={styles.surface}>
        <nav className={styles.tabs} aria-label="Secciones de Social Intelligence">
          <a
            className={styles.tab}
            href={`?version=${selected.versionId}&tab=tabulacion`}
            aria-current={activeTab === "tabulacion" ? "page" : undefined}
          >
            Tabulación
          </a>
          <a
            className={styles.tab}
            href={`?version=${selected.versionId}&tab=abiertas`}
            aria-current={activeTab === "abiertas" ? "page" : undefined}
          >
            Respuestas abiertas
          </a>
        </nav>

        {activeTab === "tabulacion" ? (
          <TabulationPanel tabulation={tabulation} />
        ) : coding ? (
          <>
            <SocialOverview
              metrics={coding.metrics}
              distributions={coding.distributions}
              taxonomy={coding.taxonomy}
              runs={coding.runs}
              tenant={ctx.tenantSlug}
              project={project}
              surveyVersionId={selected.versionId}
              questionId={openQuestionId}
              canRunAi={can(ctx, "social.ai.run")}
              aiStatus={aiStatusFor(getEnv().classifier)}
            />
            <OpenResponseQueue
              responses={coding.responses}
              taxonomy={coding.taxonomy}
              tenant={ctx.tenantSlug}
              project={project}
            />
          </>
        ) : (
          <p className={styles.note} data-system-state="feature-disabled">
            La codificación asistida no está activa en este proyecto. La tabulación determinista no
            depende de ella y sigue disponible en la pestaña anterior.
          </p>
        )}
      </div>
    </WorkspaceShell>
  );
}
