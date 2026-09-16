"use client";

import type {
  ClassificationRunSummary,
  SocialDistributions,
  SocialWorkflowMetrics,
  TaxonomyVersionSummary,
} from "@eia/application";
import { Chip, Panel, PanelBody, PanelHeader } from "@eia/ui";
import { useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { startClassificationRunAction } from "@/lib/social-actions";

import styles from "./social.module.css";

/**
 * The workflow header: how much there is to code, how far the coding has got, and how often the
 * specialist has agreed with the model.
 *
 * The agreement figure is the one that most needs its wording watched. The reviewer decided while
 * looking at the proposal, so this is concordance between an assisted human and the thing that
 * assisted them — an operational measure. The label says "coincidencia", the help text says why it
 * is not accuracy, and neither the label nor the number is ever shortened to a percentage on its
 * own.
 */
export function SocialOverview({
  metrics,
  distributions,
  taxonomy,
  runs,
  tenant,
  project,
  surveyVersionId,
  questionId,
  canRunAi,
  aiStatus,
}: {
  metrics: SocialWorkflowMetrics;
  distributions: SocialDistributions;
  taxonomy: TaxonomyVersionSummary | null;
  runs: ReadonlyArray<ClassificationRunSummary>;
  tenant: string;
  project: string;
  surveyVersionId: string;
  questionId: string | null;
  canRunAi: boolean;
  /**
   * Whether this environment has a classifier at all (IG4-001). Separate from `canRunAi`, which is
   * about the person: one is "you may not", the other is "nothing here can".
   */
  aiStatus: { readonly available: boolean; readonly note: string };
}) {
  const { t, fmt } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const startRun = () => {
    if (!taxonomy || !questionId) return;
    setMessage(null);
    startTransition(async () => {
      const result = await startClassificationRunAction({
        tenant,
        project,
        taxonomyVersionId: taxonomy.versionId,
        surveyVersionId,
        questionId,
      });
      setMessage(result.ok ? (result.message ?? t("social.runCreated")) : result.error);
    });
  };

  return (
    <div className={styles.overview}>
      <Panel>
        <PanelHeader
          label={t("social.codingTitle")}
          action={
            aiStatus.available && canRunAi && taxonomy && questionId ? (
              <button
                type="button"
                className={styles.primary}
                onClick={startRun}
                disabled={pending || metrics.eligible === 0}
              >
                {pending ? t("social.creatingRun") : t("social.runCoding")}
              </button>
            ) : null
          }
        />
        <PanelBody>
          {aiStatus.available ? null : (
            <p className={styles.note} data-system-state="ai-unavailable">
              {aiStatus.note}
            </p>
          )}
          <dl className={styles.kpis}>
            <Kpi label={t("social.openAnswers")} value={fmt.count(metrics.eligible)} />
            <Kpi label={t("social.proposalsReady")} value={fmt.count(metrics.succeededAi)} />
            <Kpi label={t("social.pendingReview")} value={fmt.count(metrics.pendingReview)} />
            <Kpi label={t("social.validated")} value={fmt.count(metrics.reviewed)} />
            <Kpi
              label={t("social.agreementLabel")}
              value={
                metrics.agreement.agreementRate === null
                  ? t("common.missing")
                  : fmt.percent(metrics.agreement.agreementRate)
              }
              help={t("social.agreementHelp")}
            />
            <Kpi label={t("social.overrideLabel")} value={fmt.count(metrics.agreement.overrides)} />
          </dl>

          {metrics.pendingAi > 0 || metrics.processingAi > 0 ? (
            <p className={styles.note} data-system-state="syncing">
              {t("social.queueNote", {
                count: fmt.count(metrics.pendingAi + metrics.processingAi),
              })}
            </p>
          ) : null}
          {metrics.failedAi > 0 ? (
            <p className={styles.note} data-system-state="error">
              {t("social.failedNote", { count: fmt.count(metrics.failedAi) })}
            </p>
          ) : null}
          {message ? <p className={styles.message}>{message}</p> : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader label={t("social.validatedThemes")} />
        <PanelBody>
          <p className={styles.note}>
            {t("social.validatedBase", {
              reviewed: fmt.count(distributions.validated.reviewed),
              unreviewed: fmt.count(distributions.validated.unreviewed),
            })}
          </p>
          <Distribution
            tallies={distributions.validated.tallies}
            emptyNote={t("social.noValidatedCodings")}
            variant="validated"
          />
        </PanelBody>
      </Panel>

      {distributions.provisional.tallies.length > 0 ? (
        <Panel>
          <PanelHeader
            label={t("social.provisionalTitle")}
            action={<Chip tone="warn">{t("social.provisionalChip")}</Chip>}
          />
          <PanelBody>
            <p className={styles.note}>
              {t("social.provisionalNote", {
                count: fmt.count(distributions.provisional.reviewed),
              })}
            </p>
            <Distribution
              tallies={distributions.provisional.tallies}
              emptyNote={t("social.noProposals")}
              variant="provisional"
            />
          </PanelBody>
        </Panel>
      ) : null}

      {taxonomy ? (
        <Panel>
          <PanelHeader
            label={t("social.schemeTitle")}
            action={<Chip tone="warn">{t("social.reconstructed")}</Chip>}
          />
          <PanelBody>
            <p className={styles.note}>
              {t("social.schemeVersion", { version: taxonomy.versionLabel })} {taxonomy.sourceNote}
            </p>
            {/*
              The definition's fingerprint is what proves two codings were made against the same
              scheme. It is evidence, so it stays; it is not something a specialist reads while
              working, so it does not sit in the sentence above.
            */}
            {taxonomy.definitionHash ? (
              <details className={styles.technical}>
                <summary>{t("social.schemeTechnical")}</summary>
                <p>{t("social.schemeFingerprint", { hash: taxonomy.definitionHash })}</p>
              </details>
            ) : null}
            <ul className={styles.categoryList}>
              {taxonomy.categories.map((category) => (
                <li key={category.code}>
                  <strong>{category.label}</strong>
                  <span className={styles.categoryDescription}>{category.description}</span>
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      ) : null}

      {runs.length > 0 ? (
        <Panel>
          <PanelHeader
            label={t("social.runsTitle")}
            note={t("social.runsCount", { count: fmt.count(runs.length) })}
          />
          <PanelBody>
            <p className={styles.note}>{t("social.runsNote")}</p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("social.runWhen")}</th>
                  <th scope="col">{t("common.status")}</th>
                  <th scope="col">{t("social.runProposals")}</th>
                  <th scope="col">{t("social.runScheme")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.runId}>
                    <td>{run.startedAt ? fmt.dateTime(run.startedAt) : t("common.missing")}</td>
                    <td>
                      {t(`social.runStatus.${run.status}` as "social.runStatus.QUEUED") ??
                        run.status}
                    </td>
                    <td>
                      {t("social.runProposalsOf", {
                        succeeded: fmt.count(run.succeeded),
                        queued: fmt.count(run.queued),
                      })}
                      {run.failed > 0
                        ? t("social.runFailed", { count: fmt.count(run.failed) })
                        : ""}
                    </td>
                    <td>{run.taxonomyVersionLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/*
              Which model answered, through which adapter and against which prompt version is the
              record AI governance asks us to keep (AI_GOVERNANCE.md). It is kept, and it is one
              click away — it is an audit trail, not a working view.
            */}
            <details className={styles.technical}>
              <summary>{t("social.runsTechnical")}</summary>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t("social.requestedModel")}</th>
                    <th scope="col">{t("social.resolvedModel")}</th>
                    <th scope="col">{t("social.adapter")}</th>
                    <th scope="col">{t("social.promptVersion")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.runId}>
                      <td>{run.requestedModel}</td>
                      <td>{run.resolvedModel ?? t("common.missing")}</td>
                      <td>{run.classifierKind}</td>
                      <td>
                        {run.promptVersion} · {run.promptHash}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, help }: { label: string; value: string; help?: string }) {
  // Label, then figure, then explanation. The explanation belongs *under* the number it qualifies:
  // between the two it separates a reader from the thing they came to look at, and this particular
  // number is one nobody should read without its caveat.
  return (
    <div className={styles.kpi}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {help ? <dd className={styles.kpiHelp}>{help}</dd> : null}
    </div>
  );
}

function Distribution({
  tallies,
  emptyNote,
  variant,
}: {
  tallies: ReadonlyArray<{ code: string; label: string; count: number; share: number | null }>;
  emptyNote: string;
  variant: "validated" | "provisional";
}) {
  const { t, fmt } = useI18n();
  if (tallies.length === 0) {
    return (
      <p className={styles.note} data-system-state="empty">
        {emptyNote}
      </p>
    );
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">{t("social.theme")}</th>
          <th scope="col">{t("social.responses")}</th>
          <th scope="col">{t("social.percentage")}</th>
          <th scope="col">
            <span className={styles.srOnly}>{t("social.distribution")}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {tallies.map((tally) => (
          <tr key={tally.code}>
            <th scope="row">{tally.label}</th>
            <td>{fmt.count(tally.count)}</td>
            <td>{tally.share === null ? t("common.missing") : fmt.percent(tally.share)}</td>
            <td className={styles.barCell}>
              <div className={styles.barTrack}>
                <div
                  className={variant === "validated" ? styles.barFill : styles.barFillProvisional}
                  style={{ width: `${Math.round((tally.share ?? 0) * 100)}%` }}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
