"use client";

import type { ProjectIntakeView } from "@eia/application";
import { FIELD_OFFLINE_MODES, type ReadinessCheck, type ReadinessRuleKey } from "@eia/domain";
import type { MessageKey } from "@eia/i18n";
import { Chip, Panel, PanelBody, PanelHeader, StatusChip } from "@eia/ui";
import { useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { activateProjectAction, saveProjectIntakeAction } from "@/lib/intake-actions";
import { captureChannelLabel, offlineModeLabel, projectRoleLabel } from "@/lib/labels";

import { INTAKE_STAGES, type IntakeStage } from "./stages";

import styles from "./intake.module.css";

/**
 * *Preparar proyecto* — eight stages of one page (ADR-030).
 *
 * ## Why it is not a wizard with a saved position
 *
 * A wizard remembers where somebody got to; that is a second story about the project, and it is
 * the one that goes stale. These stages are **sections of the project as it is**: the reader moves
 * between them freely, every one shows what is there now, and *Preparación* is the single place
 * that says what is still missing. There is nothing to resume, because nothing was left half-done
 * anywhere but in the project itself.
 *
 * ## What it refuses to say
 *
 * Readiness means **EIA Studio can operate this project** and nothing more. Not that the study is
 * finished, not that its documents agree, and certainly not that anything complies — those are a
 * specialist's conclusions and a Quality Gate's findings (invariant 11). The copy says so at the
 * top of the stage and again beside the verdict, because a green tick is exactly the artefact
 * somebody would otherwise quote.
 */

export function ProjectIntake({
  view,
  stage,
  basePath,
  tenant,
  project,
}: {
  view: ProjectIntakeView;
  stage: IntakeStage;
  basePath: string;
  tenant: string;
  project: string;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.surface}>
      <p className={styles.lead}>{t("intake.lead")}</p>
      <nav aria-label={t("intake.title")}>
        <ul className={styles.stages}>
          {INTAKE_STAGES.map((entry, index) => (
            <li key={entry.key}>
              <a
                aria-current={entry.key === stage ? "page" : undefined}
                className={`${styles.stage} ${entry.key === stage ? styles.stageCurrent : ""}`}
                href={`${basePath}?stage=${entry.key}`}
              >
                <span className={styles.stageIndex}>{index + 1}</span>
                {t(entry.label)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {stage === "project" ? <ProjectStage project={project} tenant={tenant} view={view} /> : null}
      {stage === "team" ? <TeamStage view={view} /> : null}
      {stage === "gis" ? <GisStage view={view} /> : null}
      {stage === "documents" ? <DocumentsStage view={view} /> : null}
      {stage === "surveys" ? <SurveysStage view={view} /> : null}
      {stage === "templates" ? <TemplatesStage view={view} /> : null}
      {stage === "readiness" ? <ReadinessStage view={view} /> : null}
      {stage === "activation" ? (
        <ActivationStage project={project} tenant={tenant} view={view} />
      ) : null}
    </div>
  );
}

function ProjectStage({
  view,
  tenant,
  project,
}: {
  view: ProjectIntakeView;
  tenant: string;
  project: string;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: view.project.name,
    officialTitle: view.project.officialTitle ?? "",
    programmeReference: view.project.programmeReference ?? "",
    locationLabel: view.project.locationLabel ?? "",
    offlineMode: view.offlineMode as string,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveProjectIntakeAction({
        tenant,
        project,
        name: form.name,
        officialTitle: form.officialTitle,
        programmeReference: form.programmeReference,
        locationLabel: form.locationLabel,
        offlineMode: form.offlineMode,
      });
      setFailed(!result.ok);
      setMessage(result.ok ? result.message : result.error);
    });
  };

  return (
    <Panel>
      <PanelHeader label={t("intake.stageProject")} />
      <PanelBody>
        {view.editable ? null : <p className={styles.note}>{t("intake.readOnly")}</p>}
        <div className={styles.fields}>
          <Field
            disabled={!view.editable}
            label={t("intake.projectName")}
            onChange={(value) => setForm((f) => ({ ...f, name: value }))}
            value={form.name}
          />
          <Field
            disabled={!view.editable}
            label={t("intake.officialTitle")}
            onChange={(value) => setForm((f) => ({ ...f, officialTitle: value }))}
            value={form.officialTitle}
          />
          <Field
            disabled={!view.editable}
            label={t("intake.programmeReference")}
            onChange={(value) => setForm((f) => ({ ...f, programmeReference: value }))}
            value={form.programmeReference}
          />
          <Field
            disabled={!view.editable}
            label={t("intake.locationLabel")}
            onChange={(value) => setForm((f) => ({ ...f, locationLabel: value }))}
            value={form.locationLabel}
          />
          <div className={styles.field}>
            <label className={styles.label} htmlFor="offline-mode">
              {t("intake.offlineMode")}
            </label>
            <select
              className={styles.select}
              disabled={!view.editable}
              id="offline-mode"
              onChange={(event) => setForm((f) => ({ ...f, offlineMode: event.target.value }))}
              value={form.offlineMode}
            >
              {FIELD_OFFLINE_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {offlineModeLabel(t, mode)}
                </option>
              ))}
            </select>
          </div>
          {/* The profile and the lifecycle are read here and changed elsewhere: a profile is a
              snapshot taken at creation (ADR-003), and the lifecycle moves at Activación. */}
          <div className={styles.field}>
            <span className={styles.label}>{t("field.captureChannel")}</span>
            <span className={styles.readonlyValue}>
              {view.campaign.captureChannel === null
                ? t("common.missing")
                : captureChannelLabel(t, view.campaign.captureChannel)}
            </span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>{t("intake.profile")}</span>
            <span className={styles.readonlyValue}>
              {t(`vocabulary.profile.${view.project.profileKey}` as MessageKey)}
            </span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>{t("intake.lifecycle")}</span>
            <span className={styles.readonlyValue}>
              {t(`vocabulary.lifecycle.${view.project.lifecycle}` as MessageKey)}
            </span>
          </div>
        </div>
        {view.editable ? (
          <div className={styles.actions}>
            <button className={styles.primary} disabled={pending} onClick={save} type="button">
              {pending ? t("intake.saving") : t("intake.save")}
            </button>
            {message ? (
              <span
                aria-live="polite"
                className={`${styles.feedback} ${failed ? styles.bad : styles.ok}`}
                role="status"
              >
                {message}
              </span>
            ) : null}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

function TeamStage({ view }: { view: ProjectIntakeView }) {
  const { t } = useI18n();
  return (
    <Panel>
      <PanelHeader label={t("intake.stageTeam")} />
      <PanelBody>
        <p className={styles.note}>{t("intake.teamNote")}</p>
        {view.team.length === 0 ? (
          <p className={styles.empty}>{t("intake.teamEmpty")}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("intake.teamMember")}</th>
                <th scope="col">{t("intake.teamRole")}</th>
                <th scope="col">{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {view.team.map((member) => (
                <tr key={member.membershipId}>
                  <td>{member.displayName ?? t("common.missing")}</td>
                  <td>{projectRoleLabel(t, member.role)}</td>
                  <td>{member.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelBody>
    </Panel>
  );
}

function GisStage({ view }: { view: ProjectIntakeView }) {
  const { t, fmt } = useI18n();
  const empty = view.cartography.activeDatasets === 0;
  return (
    <Panel>
      <PanelHeader label={t("intake.stageGis")} />
      <PanelBody>
        <p className={styles.note}>{t("intake.gisNote")}</p>
        {empty ? (
          <p className={styles.empty}>{t("intake.gisEmpty")}</p>
        ) : (
          <ul className={styles.counts}>
            <li>
              {t("intake.gisDatasets", { count: fmt.count(view.cartography.activeDatasets) })}
            </li>
            <li>
              {t("intake.gisParcels", { count: fmt.count(view.cartography.parcelsWithGeometry) })}
            </li>
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function DocumentsStage({ view }: { view: ProjectIntakeView }) {
  const { t, fmt } = useI18n();
  return (
    <Panel>
      <PanelHeader label={t("intake.stageDocuments")} />
      <PanelBody>
        {/* The distinction this stage exists to make: uploaded is not processed. */}
        <p className={styles.note}>{t("intake.documentsNote")}</p>
        {view.documents.length === 0 ? (
          <p className={styles.empty}>{t("intake.documentsEmpty")}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("documents.code")}</th>
                <th scope="col">{t("documents.document")}</th>
                <th scope="col">{t("documents.kind")}</th>
                <th scope="col">{t("common.version")}</th>
              </tr>
            </thead>
            <tbody>
              {view.documents.map((document) => (
                <tr key={document.code}>
                  <td className={styles.code}>{document.code}</td>
                  <td>{document.title}</td>
                  <td>{document.kind}</td>
                  <td className={styles.code}>
                    {document.versionLabel}
                    {document.versionCount > 1
                      ? t("documents.ofVersions", { count: fmt.count(document.versionCount) })
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelBody>
    </Panel>
  );
}

function SurveysStage({ view }: { view: ProjectIntakeView }) {
  const { t } = useI18n();
  return (
    <Panel>
      <PanelHeader label={t("intake.stageSurveys")} />
      <PanelBody>
        <p className={styles.note}>{t("intake.surveysNote")}</p>
        {view.surveys.length === 0 ? (
          <p className={styles.empty}>{t("intake.surveysEmpty")}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("reports.questionnaire")}</th>
                <th scope="col">{t("common.version")}</th>
                <th scope="col">{t("common.status")}</th>
                <th scope="col">{t("locale.label")}</th>
              </tr>
            </thead>
            <tbody>
              {view.surveys.map((survey) => (
                <tr key={`${survey.templateName}-${survey.versionLabel}`}>
                  <td>{survey.templateName}</td>
                  <td className={styles.code}>{survey.versionLabel}</td>
                  <td>
                    <StatusChip
                      label={t(
                        survey.status === "PUBLISHED"
                          ? "intake.surveyPublished"
                          : "intake.surveyDraft",
                      )}
                      tone={survey.status === "PUBLISHED" ? "ok" : "neutral"}
                    />
                  </td>
                  <td>{t("intake.surveyLanguages", { languages: survey.locales.join(" · ") })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelBody>
    </Panel>
  );
}

function TemplatesStage({ view }: { view: ProjectIntakeView }) {
  const { t } = useI18n();
  return (
    <Panel>
      <PanelHeader label={t("intake.stageTemplates")} />
      <PanelBody>
        <p className={styles.note}>{t("intake.templatesNote")}</p>
        {view.profile ? (
          <ul className={styles.counts}>
            <li>
              {t("intake.templatesInstruments")}:{" "}
              {t(`vocabulary.profileDescription.${view.profile.key}` as MessageKey)}
            </li>
          </ul>
        ) : null}
        {/* Said plainly rather than shown as an empty editor: authoring does not exist yet, and a
            disabled form would imply it is one release away. */}
        <p className={styles.empty}>{t("intake.templatesPending")}</p>
      </PanelBody>
    </Panel>
  );
}

const OUTCOME_GLYPH: Readonly<Record<ReadinessCheck["outcome"], string>> = {
  satisfied: "✓",
  blocked: "○",
  not_applicable: "—",
};

function ReadinessStage({ view }: { view: ProjectIntakeView }) {
  const { t } = useI18n();
  return (
    <Panel>
      <PanelHeader
        label={t("intake.stageReadiness")}
        badge={
          <Chip tone={view.readiness.operable ? "ok" : "warn"}>
            {t(view.readiness.operable ? "intake.readinessOperable" : "intake.readinessBlocked")}
          </Chip>
        }
      />
      <PanelBody>
        <p className={styles.note}>{t("intake.readinessScopeNote")}</p>
        <ul className={styles.checks}>
          {view.readiness.checks.map((check) => (
            <li className={styles.check} key={check.key}>
              <span aria-hidden="true" className={styles.glyph}>
                {OUTCOME_GLYPH[check.outcome]}
              </span>
              <span>
                <span className={styles.checkName}>{ruleLabel(t, check.key)}</span>
                <span className={styles.checkWhat}>{ruleWhat(t, check.key)}</span>
                {check.detail ? (
                  <span className={styles.checkDetail}>{detailLine(t, check)}</span>
                ) : null}
              </span>
              <span className={styles.severity}>
                {t(check.severity === "required" ? "intake.required" : "intake.advisory")} ·{" "}
                {t(
                  check.outcome === "satisfied"
                    ? "intake.outcomeSatisfied"
                    : check.outcome === "blocked"
                      ? "intake.outcomeBlocked"
                      : "intake.outcomeNotApplicable",
                )}
              </span>
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}

function ActivationStage({
  view,
  tenant,
  project,
}: {
  view: ProjectIntakeView;
  tenant: string;
  project: string;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const activate = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await activateProjectAction({ tenant, project });
      setFailed(!result.ok);
      setMessage(result.ok ? result.message : result.error);
    });
  };

  const alreadyLeftPlanning = view.project.lifecycle !== "planning";
  return (
    <Panel>
      <PanelHeader label={t("intake.stageActivation")} />
      <PanelBody>
        <p className={styles.verdict}>
          {t(view.readiness.operable ? "intake.readinessOperable" : "intake.readinessBlocked")}
        </p>
        <p className={styles.note}>{t("intake.activationNote")}</p>
        {alreadyLeftPlanning ? (
          <p className={styles.empty}>{t("intake.alreadyActive")}</p>
        ) : (
          <div className={styles.actions}>
            <button
              className={styles.primary}
              disabled={pending || !view.editable || !view.readiness.operable}
              onClick={activate}
              type="button"
            >
              {pending ? t("intake.activating") : t("intake.activate")}
            </button>
            {message ? (
              <span
                aria-live="polite"
                className={`${styles.feedback} ${failed ? styles.bad : styles.ok}`}
                role="status"
              >
                {message}
              </span>
            ) : null}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

function Field({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = `intake-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        className={styles.input}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={value}
      />
    </div>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

/** `project.identity` → `project_identity`: a catalogue key carries no dots (ADR-029). */
const flat = (key: ReadinessRuleKey) => key.replace(/\./g, "_");

const ruleLabel = (t: Translate, key: ReadinessRuleKey) =>
  t(`intake.rule.${flat(key)}` as MessageKey);
const ruleWhat = (t: Translate, key: ReadinessRuleKey) =>
  t(`intake.ruleWhat.${flat(key)}` as MessageKey);

/**
 * The detail beside a check, from the values the rule returned.
 *
 * The domain hands back *values* rather than a sentence (ADR-029), so a reader in either language
 * sees the same figure with their own words around it.
 */
function detailLine(t: Translate, check: ReadinessCheck): string {
  const detail = check.detail ?? {};
  return Object.entries(detail)
    .map(([field, value]) =>
      t(`intake.ruleDetail.${field}` as MessageKey, { [field]: String(value) }),
    )
    .join(" · ");
}
