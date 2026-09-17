"use client";

import type { SurveyAuthoringView } from "@eia/application";
import {
  acceptsOptions,
  CANONICAL_SURVEY_LOCALE,
  QUESTION_SENSITIVITY,
  QUESTION_TYPES,
  sectionsOf,
  SURVEY_LOCALES,
  type AuthoredDefinition,
  type AuthoredQuestion,
  type QuestionType,
} from "@eia/domain";
import { Chip, Panel, PanelBody, PanelHeader, StatusChip } from "@eia/ui";
import { useState, useTransition } from "react";

import { useI18n } from "@/components/i18n/locale-provider";
import { questionSensitivityLabel, questionTypeLabel } from "@/lib/labels";
import {
  createSurveyDraftAction,
  createSurveyTemplateAction,
  publishSurveyVersionAction,
  saveSurveyDefinitionAction,
} from "@/lib/survey-authoring-actions";

import styles from "./intake.module.css";

/**
 * *Formularios* — writing the questionnaire this project goes to the field with (ADR-037).
 *
 * ## What this surface is not
 *
 * It is not a survey designer. There is no expression editor, no skip rule, no calculated field
 * and no new question type: the author picks from the eight types the product already knows how to
 * ask, answer offline, synchronise and count. Everything on this screen maps to a column that
 * already existed, which is why the phone renders what is written here without a second
 * interpreter.
 *
 * ## The one thing it says before it does anything
 *
 * Publishing is not undoable. The copy says so above the button rather than in a confirmation
 * afterwards, because the moment it is useful is before somebody clicks.
 */

const SECOND_LOCALE = SURVEY_LOCALES.find((locale) => locale !== CANONICAL_SURVEY_LOCALE)!;

type Draft = { questions: AuthoredQuestion[] };

export function SurveyAuthoring({
  view,
  tenant,
  project,
  basePath,
}: {
  view: SurveyAuthoringView;
  tenant: string;
  project: string;
  basePath: string;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.stack}>
      <Panel>
        <PanelHeader label={t("authoring.title")} />
        <PanelBody>
          <p className={styles.note}>{t("authoring.lead")}</p>
          {!view.canAuthor ? <p className={styles.empty}>{t("authoring.readOnly")}</p> : null}
          {view.canAuthor && !view.canPublish ? (
            <p className={styles.subtle}>{t("authoring.cannotPublish")}</p>
          ) : null}

          {view.templates.length === 0 ? (
            <p className={styles.empty}>{t("intake.surveysEmpty")}</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t("reports.questionnaire")}</th>
                  <th scope="col">{t("common.version")}</th>
                  <th scope="col">{t("common.status")}</th>
                  <th scope="col">{t("locale.label")}</th>
                  <th scope="col">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {view.templates.flatMap((template) =>
                  template.versions.length === 0
                    ? [
                        <tr key={template.id}>
                          <td>{template.name}</td>
                          <td colSpan={4}>{t("authoring.noDraft")}</td>
                        </tr>,
                      ]
                    : template.versions.map((version) => (
                        <tr key={version.id}>
                          <td>{template.name}</td>
                          <td className={styles.code}>{version.versionLabel}</td>
                          <td>
                            <StatusChip
                              label={t(
                                version.status === "PUBLISHED"
                                  ? "intake.surveyPublished"
                                  : "intake.surveyDraft",
                              )}
                              tone={version.status === "PUBLISHED" ? "ok" : "neutral"}
                            />{" "}
                            {version.usedByCampaign ? (
                              <Chip>{t("authoring.usedByCampaign")}</Chip>
                            ) : null}
                          </td>
                          <td>
                            {t("authoring.questionsCount", { count: version.questionCount })} ·{" "}
                            {version.locales.join(" · ")}
                          </td>
                          <td>
                            <a href={`${basePath}?stage=surveys&version=${version.id}`}>
                              {version.status === "DRAFT"
                                ? t("authoring.edit")
                                : t("authoring.preview")}
                            </a>
                            {view.canAuthor && version.status === "PUBLISHED" ? (
                              <>
                                {" · "}
                                <NewVersionButton
                                  copyFromVersionId={version.id}
                                  label={t("authoring.newVersionFrom", {
                                    version: version.versionLabel,
                                  })}
                                  project={project}
                                  templateId={template.id}
                                  tenant={tenant}
                                />
                              </>
                            ) : null}
                          </td>
                        </tr>
                      )),
                )}
              </tbody>
            </table>
          )}

          {view.canAuthor ? (
            <NewQuestionnaire basePath={basePath} project={project} tenant={tenant} />
          ) : null}
        </PanelBody>
      </Panel>

      {view.selected ? (
        <VersionEditor
          key={view.selected.versionId}
          canAuthor={view.canAuthor}
          canPublish={view.canPublish}
          project={project}
          selected={view.selected}
          tenant={tenant}
        />
      ) : null}
    </div>
  );
}

function NewQuestionnaire({
  tenant,
  project,
  basePath,
}: {
  tenant: string;
  project: string;
  basePath: string;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({ key: "", name: "", description: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await createSurveyTemplateAction({
            tenant,
            project,
            key: form.key,
            name: form.name,
            description: form.description.trim() === "" ? null : form.description,
          });
          setFailed(!result.ok);
          setMessage(result.ok ? result.message : result.error);
          if (result.ok && result.versionId) {
            window.location.assign(`${basePath}?stage=surveys&version=${result.versionId}`);
          }
        });
      }}
      style={{ marginTop: 18 }}
    >
      <h3 className={styles.label}>{t("authoring.newQuestionnaire")}</h3>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.field}>
            <span className={styles.label}>{t("authoring.keyLabel")}</span>
            <input
              className={styles.input}
              onChange={(event) => setForm({ ...form, key: event.target.value })}
              value={form.key}
            />
          </label>
          {/* Outside the label on purpose: a hint inside one becomes part of the field's
              accessible name, and a screen reader would read the whole paragraph as the label. */}
          <span className={styles.subtle}>{t("authoring.keyHint")}</span>
        </div>
        <label className={styles.field}>
          <span className={styles.label}>{t("authoring.nameLabel")}</span>
          <input
            className={styles.input}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            value={form.name}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t("authoring.descriptionLabel")}</span>
          <input
            className={styles.input}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            value={form.description}
          />
        </label>
      </div>
      <div className={styles.actions}>
        <button className={styles.primary} disabled={pending} type="submit">
          {pending ? t("intake.saving") : t("authoring.create")}
        </button>
        {message ? (
          <span className={`${styles.feedback} ${failed ? styles.bad : styles.ok}`}>{message}</span>
        ) : null}
      </div>
    </form>
  );
}

function NewVersionButton({
  tenant,
  project,
  templateId,
  copyFromVersionId,
  label,
}: {
  tenant: string;
  project: string;
  templateId: string;
  copyFromVersionId: string | null;
  label: string;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button
        className={styles.linkish}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await createSurveyDraftAction({
              tenant,
              project,
              templateId,
              copyFromVersionId,
            });
            if (result.ok && result.versionId) {
              window.location.assign(`?stage=surveys&version=${result.versionId}`);
            } else if (!result.ok) {
              setMessage(result.error);
            }
          })
        }
        type="button"
      >
        {pending ? t("intake.saving") : label}
      </button>
      {message ? <span className={`${styles.feedback} ${styles.bad}`}>{message}</span> : null}
    </>
  );
}

/* ---------------------------------------------------------------------------------------------
 * the editor
 * ------------------------------------------------------------------------------------------ */

function emptyQuestion(ordinal: number): AuthoredQuestion {
  return {
    code: "",
    ordinal,
    type: "SHORT_TEXT",
    prompt: "",
    helpText: null,
    required: false,
    sensitivity: "NON_PERSONAL",
    section: null,
    options: [],
    translations: {},
  };
}

function VersionEditor({
  selected,
  tenant,
  project,
  canAuthor,
  canPublish,
}: {
  selected: NonNullable<SurveyAuthoringView["selected"]>;
  tenant: string;
  project: string;
  canAuthor: boolean;
  canPublish: boolean;
}) {
  const { t } = useI18n();
  const editable = canAuthor && selected.status === "DRAFT";
  const [draft, setDraft] = useState<Draft>({ questions: [...selected.definition.questions] });
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [previewLocale, setPreviewLocale] = useState<string>(CANONICAL_SURVEY_LOCALE);
  const [pending, start] = useTransition();

  const update = (index: number, next: AuthoredQuestion) => {
    const questions = [...draft.questions];
    questions[index] = next;
    setDraft({ questions });
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.questions.length) return;
    const questions = [...draft.questions];
    const a = questions[index]!;
    const b = questions[target]!;
    questions[index] = { ...b, ordinal: index };
    questions[target] = { ...a, ordinal: target };
    setDraft({ questions });
  };

  const renumbered = (questions: AuthoredQuestion[]): AuthoredQuestion[] =>
    questions.map((question, index) => ({ ...question, ordinal: index }));

  return (
    <Panel>
      {/* A published version is not a draft, and a header that said so would be the one line on
          this page a reader would quote back. */}
      <PanelHeader
        label={`${selected.templateName} · ${t(
          selected.status === "DRAFT" ? "authoring.editing" : "authoring.viewing",
          { version: selected.versionLabel },
        )}`}
      />
      <PanelBody>
        {selected.status !== "DRAFT" ? (
          <p className={styles.note}>{t("authoring.immutableNote")}</p>
        ) : (
          <p className={styles.note}>{t("authoring.secondLanguageNote")}</p>
        )}

        {draft.questions.length === 0 ? (
          <p className={styles.empty}>{t("authoring.noQuestions")}</p>
        ) : null}

        {draft.questions.map((question, index) => (
          <QuestionEditor
            editable={editable}
            index={index}
            key={`${index}-${question.code}`}
            onChange={(next) => update(index, next)}
            onMove={(delta) => move(index, delta)}
            onRemove={() =>
              setDraft({
                questions: renumbered(draft.questions.filter((_, position) => position !== index)),
              })
            }
            question={question}
          />
        ))}

        {editable ? (
          <div className={styles.actions} style={{ marginTop: 12 }}>
            <button
              className={styles.primary}
              onClick={() =>
                setDraft({
                  questions: [...draft.questions, emptyQuestion(draft.questions.length)],
                })
              }
              type="button"
            >
              {t("authoring.addQuestion")}
            </button>
            <button
              className={styles.primary}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await saveSurveyDefinitionAction({
                    tenant,
                    project,
                    versionId: selected.versionId,
                    definition: { questions: renumbered(draft.questions) },
                  });
                  setFailed(!result.ok);
                  setMessage(result.ok ? result.message : result.error);
                })
              }
              type="button"
            >
              {pending ? t("intake.saving") : t("intake.save")}
            </button>
          </div>
        ) : null}

        {editable && canPublish ? (
          <div style={{ marginTop: 12 }}>
            <p className={styles.note}>{t("authoring.publishWarning")}</p>
            <button
              className={styles.primary}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await publishSurveyVersionAction({
                    tenant,
                    project,
                    versionId: selected.versionId,
                  });
                  setFailed(!result.ok);
                  setMessage(result.ok ? result.message : result.error);
                })
              }
              type="button"
            >
              {pending ? t("authoring.publishing") : t("authoring.publish")}
            </button>
          </div>
        ) : null}

        {message ? (
          <p className={`${styles.feedback} ${failed ? styles.bad : styles.ok}`}>{message}</p>
        ) : null}

        <Preview
          definition={{ questions: draft.questions }}
          locale={previewLocale}
          onLocale={setPreviewLocale}
        />
      </PanelBody>
    </Panel>
  );
}

function QuestionEditor({
  question,
  index,
  editable,
  onChange,
  onRemove,
  onMove,
}: {
  question: AuthoredQuestion;
  index: number;
  editable: boolean;
  onChange: (next: AuthoredQuestion) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const { t } = useI18n();
  const translation = question.translations[SECOND_LOCALE] ?? {
    prompt: "",
    helpText: null,
    section: null,
  };

  const setTranslation = (next: {
    prompt: string;
    helpText: string | null;
    section: string | null;
  }) => {
    const translations = { ...question.translations };
    if (next.prompt.trim() === "" && (next.helpText ?? "") === "" && (next.section ?? "") === "") {
      delete translations[SECOND_LOCALE];
    } else {
      translations[SECOND_LOCALE] = next;
    }
    onChange({ ...question, translations });
  };

  return (
    <section
      style={{
        border: "1px solid var(--eia-hairline)",
        padding: 12,
        marginTop: 10,
        borderRadius: 2,
      }}
    >
      <div className={styles.actions} style={{ justifyContent: "space-between" }}>
        <span className={styles.label}>{index + 1}</span>
        {editable ? (
          <span className={styles.actions}>
            <button className={styles.linkish} onClick={() => onMove(-1)} type="button">
              {t("authoring.moveUp")}
            </button>
            <button className={styles.linkish} onClick={() => onMove(1)} type="button">
              {t("authoring.moveDown")}
            </button>
            <button className={styles.linkish} onClick={onRemove} type="button">
              {t("authoring.removeQuestion")}
            </button>
          </span>
        ) : null}
      </div>

      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.field}>
            <span className={styles.label}>{t("authoring.questionSection")}</span>
            <input
              className={styles.input}
              disabled={!editable}
              onChange={(event) =>
                onChange({
                  ...question,
                  section: event.target.value.trim() === "" ? null : event.target.value,
                })
              }
              value={question.section ?? ""}
            />
          </label>
          <span className={styles.subtle}>{t("authoring.sectionHint")}</span>
        </div>
        <div className={styles.field}>
          <label className={styles.field}>
            <span className={styles.label}>{t("authoring.questionCode")}</span>
            <input
              className={styles.input}
              disabled={!editable}
              onChange={(event) => onChange({ ...question, code: event.target.value })}
              value={question.code}
            />
          </label>
          <span className={styles.subtle}>{t("authoring.questionCodeHint")}</span>
        </div>
        <label className={styles.field}>
          <span className={styles.label}>{t("authoring.questionType")}</span>
          <select
            className={styles.select}
            disabled={!editable}
            onChange={(event) => {
              const type = event.target.value as QuestionType;
              onChange({
                ...question,
                type,
                options: acceptsOptions(type) ? question.options : [],
              });
            }}
            value={question.type}
          >
            {QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {questionTypeLabel(t, type)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t("authoring.questionSensitivity")}</span>
          <select
            className={styles.select}
            disabled={!editable}
            onChange={(event) =>
              onChange({
                ...question,
                sensitivity: event.target.value as AuthoredQuestion["sensitivity"],
              })
            }
            value={question.sensitivity}
          >
            {QUESTION_SENSITIVITY.map((value) => (
              <option key={value} value={value}>
                {questionSensitivityLabel(t, value)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t("authoring.questionRequired")}</span>
          <input
            checked={question.required}
            disabled={!editable}
            onChange={(event) => onChange({ ...question, required: event.target.checked })}
            type="checkbox"
          />
        </label>
      </div>

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>
            {t("authoring.canonicalLanguage")} · {t("authoring.questionPrompt")}
          </span>
          <input
            className={styles.input}
            disabled={!editable}
            onChange={(event) => onChange({ ...question, prompt: event.target.value })}
            value={question.prompt}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>
            {t("authoring.canonicalLanguage")} · {t("authoring.questionHelp")}
          </span>
          <input
            className={styles.input}
            disabled={!editable}
            onChange={(event) =>
              onChange({
                ...question,
                helpText: event.target.value.trim() === "" ? null : event.target.value,
              })
            }
            value={question.helpText ?? ""}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>
            {t("authoring.secondLanguage")} · {t("authoring.questionPrompt")}
          </span>
          <input
            className={styles.input}
            disabled={!editable}
            onChange={(event) => setTranslation({ ...translation, prompt: event.target.value })}
            value={translation.prompt}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>
            {t("authoring.secondLanguage")} · {t("authoring.questionSection")}
          </span>
          <input
            className={styles.input}
            disabled={!editable}
            onChange={(event) =>
              setTranslation({
                ...translation,
                section: event.target.value.trim() === "" ? null : event.target.value,
              })
            }
            value={translation.section ?? ""}
          />
        </label>
      </div>

      {acceptsOptions(question.type) ? (
        <OptionsEditor editable={editable} onChange={onChange} question={question} />
      ) : null}
    </section>
  );
}

function OptionsEditor({
  question,
  editable,
  onChange,
}: {
  question: AuthoredQuestion;
  editable: boolean;
  onChange: (next: AuthoredQuestion) => void;
}) {
  const { t } = useI18n();
  const setOption = (index: number, next: AuthoredQuestion["options"][number]) => {
    const options = [...question.options];
    options[index] = next;
    onChange({ ...question, options });
  };

  return (
    <div style={{ marginTop: 8 }}>
      <span className={styles.label}>{t("authoring.options")}</span>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t("authoring.optionCode")}</th>
            <th scope="col">
              {t("authoring.canonicalLanguage")} · {t("authoring.optionLabel")}
            </th>
            <th scope="col">
              {t("authoring.secondLanguage")} · {t("authoring.optionLabel")}
            </th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {question.options.map((option, index) => (
            <tr key={index}>
              <td>
                {/* A cell has a column header but an input has no name, so each carries its own —
                    a table of unnamed boxes is unusable to anybody not looking at it. */}
                <input
                  aria-label={`${t("authoring.optionCode")} ${index + 1}`}
                  className={styles.input}
                  disabled={!editable}
                  onChange={(event) => setOption(index, { ...option, code: event.target.value })}
                  value={option.code}
                />
              </td>
              <td>
                <input
                  aria-label={`${t("authoring.canonicalLanguage")} · ${t("authoring.optionLabel")} ${index + 1}`}
                  className={styles.input}
                  disabled={!editable}
                  onChange={(event) => setOption(index, { ...option, label: event.target.value })}
                  value={option.label}
                />
              </td>
              <td>
                <input
                  aria-label={`${t("authoring.secondLanguage")} · ${t("authoring.optionLabel")} ${index + 1}`}
                  className={styles.input}
                  disabled={!editable}
                  onChange={(event) => {
                    const translations = { ...option.translations };
                    if (event.target.value.trim() === "") delete translations[SECOND_LOCALE];
                    else translations[SECOND_LOCALE] = event.target.value;
                    setOption(index, { ...option, translations });
                  }}
                  value={option.translations[SECOND_LOCALE] ?? ""}
                />
              </td>
              <td>
                {editable ? (
                  <button
                    className={styles.linkish}
                    onClick={() =>
                      onChange({
                        ...question,
                        options: question.options
                          .filter((_, position) => position !== index)
                          .map((entry, position) => ({ ...entry, ordinal: position })),
                      })
                    }
                    type="button"
                  >
                    {t("authoring.removeOption")}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable ? (
        <button
          className={styles.primary}
          onClick={() =>
            onChange({
              ...question,
              options: [
                ...question.options,
                {
                  code: "",
                  label: "",
                  ordinal: question.options.length,
                  translations: {},
                },
              ],
            })
          }
          type="button"
        >
          {t("authoring.addOption")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * How the questionnaire reads, grouped exactly as the phone groups it.
 *
 * `sectionsOf` is the domain's, and the mobile application derives its own grouping from the same
 * field with the same rule — so what an author sees here is what a technician is shown, rather
 * than two renderings that happen to agree today.
 */
function Preview({
  definition,
  locale,
  onLocale,
}: {
  definition: AuthoredDefinition;
  locale: string;
  onLocale: (locale: string) => void;
}) {
  const { t } = useI18n();
  const groups = sectionsOf(definition);

  const words = (question: AuthoredQuestion) => {
    if (locale === CANONICAL_SURVEY_LOCALE) return question.prompt;
    return question.translations[locale]?.prompt || question.prompt;
  };
  const heading = (group: (typeof groups)[number]) => {
    if (group.section === null) return null;
    if (locale === CANONICAL_SURVEY_LOCALE) return group.section;
    return group.questions[0]?.translations[locale]?.section || group.section;
  };

  return (
    <div style={{ marginTop: 18 }}>
      <label className={styles.field} style={{ maxWidth: 240 }}>
        <span className={styles.label}>{t("authoring.previewIn")}</span>
        <select
          className={styles.select}
          onChange={(event) => onLocale(event.target.value)}
          value={locale}
        >
          {SURVEY_LOCALES.map((value) => (
            <option key={value} value={value}>
              {value === CANONICAL_SURVEY_LOCALE
                ? t("authoring.canonicalLanguage")
                : t("authoring.secondLanguage")}
            </option>
          ))}
        </select>
      </label>
      {groups.length === 0 ? (
        <p className={styles.empty}>{t("authoring.previewEmpty")}</p>
      ) : (
        groups.map((group, index) => (
          <div key={index} style={{ marginTop: 10 }}>
            {heading(group) !== null ? <h4 className={styles.label}>{heading(group)}</h4> : null}
            <ol className={styles.counts}>
              {group.questions.map((question) => (
                <li key={question.code}>
                  {words(question)}
                  {question.required ? " *" : ""}{" "}
                  <span className={styles.subtle}>{questionTypeLabel(t, question.type)}</span>
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </div>
  );
}
