import {
  listDocumentReviewCandidates,
  listDocumentReviewRuns,
  loadDocuments,
  loadWorkspaceHeader,
} from "@eia/application";
import { can } from "@eia/domain";
import { Panel, PanelBody, PanelHeader } from "@eia/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CandidateDecision } from "@/components/documents/candidate-decision";
import { ReviewRunner } from "@/components/documents/review-runner";
import { projectBreadcrumb, projectLabel, WorkspaceShell } from "@/components/workspace-shell";
import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  reviewCandidateStateLabel,
  reviewDecisionWord,
  reviewEvidenceRoleLabel,
  reviewLensLabel,
  reviewRunStatusLabel,
  reviewSupportHelp,
  reviewSupportLabel,
  surfaceLabel,
} from "@/lib/labels";
import { getI18n } from "@/lib/locale";
import { projectPath } from "@/lib/navigation";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";
import { PermissionDeniedState } from "@/lib/system-state";

import styles from "@/components/documents/documents.module.css";

export const dynamic = "force-dynamic";

/**
 * Assisted review: what a model proposed, and what a person decided about it (ADR-035).
 *
 * It is a page of its own rather than a section of *Documentos*, and it is **not** part of
 * *Control de consistencia*, for the reason the whole ADR exists: a reader must never be in a
 * position where a rule's finding and a model's suggestion are one scroll apart in the same list.
 * Every candidate on this page is headed *Candidato generado por IA*, and its state says whether a
 * specialist has been near it.
 *
 * `quality.rag_assistant` gates the page — the AI-over-documents key (FEATURES.md §2) — beside
 * `core.documents`, which the route already resolves. Running a review is `quality.write` and
 * settling a candidate is `quality.review`: the same split the Quality Gate makes between checking
 * and deciding, reused rather than duplicated.
 */
export default async function DocumentReviewPage({
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
  // The assistant capability is what governs AI over this project's documents. A project that
  // holds documents without it reaches the corpus and not this page.
  if (ctx.capabilities["quality.rag_assistant"] !== true) notFound();

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
      `${surfaceLabel(t, "documents")} · ${t("documents.review.title")}`,
    ),
  };

  if (!can(ctx, "quality.read")) {
    return (
      <WorkspaceShell {...shell}>
        <div style={{ padding: "8px 0" }}>
          <PermissionDeniedState
            role={ctx.projectRole ?? ctx.tenantRole}
            restrictedData={t("documents.review.title")}
            backHref={projectPath(ctx.tenantSlug, project, "documents")}
          />
        </div>
      </WorkspaceShell>
    );
  }

  let runs;
  let candidates;
  let documents;
  try {
    [runs, candidates, documents] = await Promise.all([
      listDocumentReviewRuns(getDb(), ctx),
      listDocumentReviewCandidates(getDb(), ctx),
      loadDocuments(getDb(), ctx),
    ]);
  } catch (error) {
    const outcome = accessForDomainError(error);
    if (outcome?.kind === "not-found") notFound();
    throw error;
  }

  const reviewer = getEnv().reviewer;
  const mayRun = can(ctx, "quality.write");
  const mayDecide = can(ctx, "quality.review");

  return (
    <WorkspaceShell {...shell}>
      <div className={styles.surface}>
        <p className={styles.note}>
          <Link className={styles.docLink} href={projectPath(ctx.tenantSlug, project, "documents")}>
            {t("documents.title")}
          </Link>
        </p>

        {reviewer.state === "AVAILABLE" && mayRun ? (
          <ReviewRunner
            documents={documents.map((document) => ({
              id: document.id,
              code: document.code,
              title: document.title,
              privacyClassification: document.privacyClassification,
              processingState: document.processingState,
              // Both conditions, computed here rather than guessed by the component: only a
              // version declared free of personal data *and* already read has anything a model
              // may be given.
              eligible:
                document.privacyClassification === "NO_PERSONAL_DATA_KNOWN" &&
                document.processingState === "READY",
            }))}
            project={project}
            tenant={ctx.tenantSlug}
          />
        ) : null}
        {reviewer.state === "UNAVAILABLE" ? (
          <Panel>
            <PanelHeader label={t("documents.review.title")} note={t("documents.review.lead")} />
            <PanelBody>
              {/* The operator-facing `detail` names variables and stays in the logs; what a
                  consultant reads is that the feature is off here and why it is not faked. */}
              <p className={styles.note} data-system-state="AI unavailable">
                {t(`documents.review.unavailable.${reviewer.reason}`)}
              </p>
            </PanelBody>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader
            label={t("documents.review.candidatesTitle")}
            note={t("documents.review.candidatesLead")}
          />
          <PanelBody>
            {candidates.length === 0 ? (
              <p className={styles.note} data-system-state="empty">
                {t("documents.review.noCandidates")}
              </p>
            ) : (
              <ul className={styles.reviewCandidates}>
                {candidates.map((candidate) => (
                  <li className={styles.candidate} key={candidate.id} data-testid="ai-candidate">
                    <div className={styles.candidateHead}>
                      <span className={styles.code}>{candidate.code}</span>
                      {/* Never "detected", never "finding". The origin is the first thing read. */}
                      <span className={styles.candidateOrigin}>
                        {t("documents.review.candidate")}
                      </span>
                      <span className={styles.candidateOrigin}>
                        {reviewCandidateStateLabel(t, candidate.state)}
                      </span>
                      <span className={styles.candidateOrigin}>
                        {reviewLensLabel(t, candidate.lens)}
                      </span>
                    </div>
                    <h3 className={styles.candidateTitle}>{candidate.title}</h3>

                    <p className={styles.candidateBody}>
                      <span className={styles.candidateLabel}>
                        {t("documents.review.observation")}
                      </span>
                      {candidate.observation}
                    </p>
                    <p className={styles.candidateBody}>
                      <span className={styles.candidateLabel}>
                        {t("documents.review.suggestedCheck")}
                      </span>
                      {candidate.suggestedCheck}
                    </p>

                    <p className={styles.strategy}>
                      {reviewSupportLabel(t, candidate.support)} ·{" "}
                      {reviewSupportHelp(t, candidate.support)}
                    </p>

                    <div>
                      <span className={styles.candidateLabel}>
                        {t("documents.review.evidence")}
                      </span>
                      <ul className={styles.candidateEvidence}>
                        {candidate.evidence.map((item) => (
                          <li
                            className={styles.citation}
                            key={`${candidate.id}-${item.chunkId}-${item.role}`}
                          >
                            <div className={styles.citationHead}>
                              <span className={styles.candidateOrigin}>
                                {reviewEvidenceRoleLabel(t, item.role)}
                              </span>
                              <span className={styles.citationRef}>{item.label}</span>
                            </div>
                            {/* The passage's own words, quoted. Never the model's. */}
                            <blockquote className={styles.quote}>{item.quote}</blockquote>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <p className={styles.strategy}>
                      {t("documents.review.runModel")}: {candidate.requestedModel} (
                      {candidate.adapterKind})
                    </p>

                    {candidate.decisions.length > 0 ? (
                      <div>
                        <span className={styles.candidateLabel}>
                          {t("documents.review.decisionsTitle")}
                        </span>
                        <ul className={styles.decisionHistory}>
                          {candidate.decisions.map((decision, index) => (
                            <li key={`${candidate.id}-decision-${index}`}>
                              {t("documents.review.decidedBy", {
                                decision: reviewDecisionWord(t, decision.decision),
                                when: i18n.fmt.dateTime(decision.decidedAt),
                              })}
                              {" — "}
                              {decision.justification}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {mayDecide ? (
                      <CandidateDecision
                        candidateId={candidate.id}
                        project={project}
                        state={candidate.state}
                        support={candidate.support}
                        tenant={ctx.tenantSlug}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader label={t("documents.review.runsTitle")} />
          <PanelBody>
            {runs.length === 0 ? (
              <p className={styles.note} data-system-state="empty">
                {t("documents.review.noRuns")}
              </p>
            ) : (
              <table className={styles.table}>
                <caption className="sr-only">{t("documents.review.runsCaption")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("documents.review.runLens")}</th>
                    <th scope="col">{t("documents.review.runStatus")}</th>
                    <th scope="col">{t("documents.review.runSources")}</th>
                    <th scope="col">{t("documents.review.runPassages")}</th>
                    <th scope="col">{t("documents.review.runCandidates")}</th>
                    <th scope="col">{t("documents.review.runRefused")}</th>
                    <th scope="col">{t("documents.review.runModel")}</th>
                    <th scope="col">{t("documents.review.runWhen")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td>{reviewLensLabel(t, run.lens)}</td>
                      <td>{reviewRunStatusLabel(t, run.status)}</td>
                      <td>{i18n.fmt.count(run.sourceCount)}</td>
                      <td>{i18n.fmt.count(run.passageCount)}</td>
                      <td>{i18n.fmt.count(run.candidatesCreated)}</td>
                      <td>{i18n.fmt.count(run.candidatesRefused)}</td>
                      <td className={styles.code}>{run.requestedModel}</td>
                      <td>{i18n.fmt.dateTime(run.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className={styles.note}>{t("documents.review.runRefusedHelp")}</p>
            <p className={styles.note}>{t("documents.review.corpusNote")}</p>
          </PanelBody>
        </Panel>
      </div>
    </WorkspaceShell>
  );
}
