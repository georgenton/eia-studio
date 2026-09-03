"use client";

import type { AnswerView, AssignmentDetail, SurveyQuestionView } from "@eia/application";
import { isChoiceQuestion, LOCATION_OUTCOME_LABEL, type LocationOutcome } from "@eia/domain";
import { useCallback, useId, useRef, useState, useTransition } from "react";

import {
  saveDraftAction,
  startVisitAction,
  submitSurveyAction,
  type FieldActionResult,
} from "@/lib/field-actions";

import styles from "./survey-form.module.css";

/**
 * The capture surface: start a visit, answer the published questionnaire, save a draft, submit.
 *
 * ## What this component is not
 *
 * It is not a survey designer and it is not a schema-driven form framework. It renders the seven
 * question types the domain actually defines, against a version that is already published and can
 * no longer change. Nothing here can edit a question, an option or a version — those tables are
 * frozen by database triggers, and this file has no code that would try.
 *
 * ## Where the truth lives
 *
 * Every button posts to a server action that rebuilds the request context, re-resolves the
 * assignment's ownership and re-validates every answer against the version the *campaign* names.
 * The state below is a convenience for typing; it is never the thing that decides what is saved.
 * A refresh reloads the draft from the database, which is the point of saving one.
 */
type AnswerState = Record<string, AnswerView>;

function initialAnswers(detail: AssignmentDetail): AnswerState {
  return { ...detail.answers };
}

/** Browser geolocation, asked for once, never fabricated. */
async function readLocation(): Promise<
  | {
      outcome: "captured";
      latitude: number;
      longitude: number;
      accuracyM: number | null;
      capturedAt: string;
    }
  | { outcome: Exclude<LocationOutcome, "captured"> }
> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { outcome: "unavailable" };
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          outcome: "captured",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          // A device that reports no usable accuracy — 0, NaN, an emulated fix — still gave a
          // real coordinate. The reading is kept and the accuracy recorded as unknown, rather
          // than losing the visit over a number the schema would rightly refuse.
          accuracyM:
            Number.isFinite(position.coords.accuracy) && position.coords.accuracy > 0
              ? position.coords.accuracy
              : null,
          // The device's own reading time, kept separate from the server's visit timestamps.
          capturedAt: new Date(position.timestamp).toISOString(),
        }),
      (error) =>
        // A refusal is a fact about the visit, recorded as such. Nothing invents a coordinate.
        resolve({ outcome: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

export function SurveyForm({
  detail,
  tenant,
  project,
  backHref,
}: {
  detail: AssignmentDetail;
  tenant: string;
  project: string;
  backHref: string;
}) {
  const [answers, setAnswers] = useState<AnswerState>(() => initialAnswers(detail));
  const [result, setResult] = useState<FieldActionResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement | null>(null);
  const statusId = useId();

  const submitted = detail.assignment.instanceStatus === "SUBMITTED";
  const visitDone = detail.visit !== null && detail.visit.status === "COMPLETED";

  const setAnswer = useCallback((code: string, value: AnswerView | undefined) => {
    setAnswers((current) => {
      const next = { ...current };
      if (value === undefined) delete next[code];
      else next[code] = value;
      return next;
    });
    setFieldErrors((current) => {
      if (!(code in current)) return current;
      const next = { ...current };
      delete next[code];
      return next;
    });
  }, []);

  const beginVisit = () => {
    startTransition(async () => {
      const location = await readLocation();
      const outcome = await startVisitAction({
        tenant,
        project,
        assignmentId: detail.assignment.id,
        locationOutcome: location.outcome,
        latitude: location.outcome === "captured" ? location.latitude : null,
        longitude: location.outcome === "captured" ? location.longitude : null,
        accuracyM: location.outcome === "captured" ? location.accuracyM : null,
        capturedAt: location.outcome === "captured" ? location.capturedAt : null,
      });
      setResult(outcome);
      if (outcome.ok) window.location.reload();
    });
  };

  const run = (action: typeof saveDraftAction, focusFirstError: boolean) => {
    startTransition(async () => {
      const outcome = await action({
        tenant,
        project,
        assignmentId: detail.assignment.id,
        visitId: detail.visit?.id ?? null,
        answers: toPayload(answers, detail.questions),
      });
      setResult(outcome);
      setFieldErrors(outcome.ok ? {} : (outcome.fieldErrors ?? {}));

      if (!outcome.ok && focusFirstError) {
        // Required-field failures name their questions; move the caret to the first one so a
        // technician on a phone is not left scrolling for what went wrong.
        const missing = missingRequired(detail.questions, answers);
        const target = missing[0];
        if (target) {
          setFieldErrors((current) => ({
            ...current,
            ...Object.fromEntries(missing.map((code) => [code, "Esta pregunta es obligatoria."])),
          }));
          formRef.current
            ?.querySelector<HTMLElement>(`[data-question="${target}"] :is(input,textarea,select)`)
            ?.focus();
        }
      }
      if (outcome.ok && action === submitSurveyAction) window.location.reload();
    });
  };

  return (
    <form
      className={styles.form}
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        run(submitSurveyAction, true);
      }}
    >
      <section aria-labelledby={`${statusId}-visit`} className={styles.visitBlock}>
        <h2 className={styles.sectionTitle} id={`${statusId}-visit`}>
          Visita
        </h2>
        {detail.visit === null ? (
          <>
            <p className={styles.hint}>
              Al iniciar la visita se pedirá tu ubicación. Puedes continuar sin ella: la ficha no
              queda bloqueada.
            </p>
            <button
              className={styles.primary}
              disabled={pending}
              onClick={beginVisit}
              type="button"
            >
              {pending ? "Iniciando…" : "Iniciar visita"}
            </button>
          </>
        ) : (
          <dl className={styles.visitFacts}>
            <div>
              <dt>Estado</dt>
              <dd>{visitDone ? "Completada" : "En curso"}</dd>
            </div>
            <div>
              <dt>Ubicación</dt>
              <dd>
                {LOCATION_OUTCOME_LABEL[detail.visit.locationOutcome]}
                {detail.visit.locationOutcome === "captured" && detail.visit.accuracyM !== null ? (
                  <span className={styles.accuracy}>
                    {" "}
                    · ±{Math.round(detail.visit.accuracyM)} m
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {detail.visit === null ? null : (
        <section aria-labelledby={`${statusId}-survey`}>
          <h2 className={styles.sectionTitle} id={`${statusId}-survey`}>
            {detail.assignment.campaignName}
            <span className={styles.version}> · {detail.assignment.surveyVersionLabel}</span>
          </h2>

          {submitted ? (
            <p className={styles.submittedNote} role="status">
              Esta ficha fue enviada y ya no puede editarse. Una corrección será un flujo revisado,
              no una edición silenciosa.
            </p>
          ) : null}

          <ol className={styles.questions}>
            {detail.questions.map((question) => (
              <QuestionField
                answer={answers[question.code]}
                disabled={submitted || pending}
                error={fieldErrors[question.code]}
                key={question.id}
                onChange={setAnswer}
                question={question}
              />
            ))}
          </ol>
        </section>
      )}

      <div aria-live="polite" className={styles.status} id={statusId}>
        {result === null ? null : result.ok ? (
          <span className={styles.ok}>{result.message ?? "Guardado."}</span>
        ) : (
          <span className={styles.error}>{result.error}</span>
        )}
      </div>

      {detail.visit === null || submitted ? (
        <a className={styles.secondary} href={backHref}>
          Volver a mi trabajo
        </a>
      ) : (
        <div className={styles.actions}>
          {/* Two distinct verbs. A draft never demands the required answers — a technician saving
              half a form mid-visit is the ordinary case, and refusing it invites invented values. */}
          <button
            className={styles.secondary}
            disabled={pending}
            onClick={() => run(saveDraftAction, false)}
            type="button"
          >
            Guardar borrador
          </button>
          <button className={styles.primary} disabled={pending} type="submit">
            {pending ? "Enviando…" : "Enviar ficha"}
          </button>
        </div>
      )}
    </form>
  );
}

function missingRequired(
  questions: ReadonlyArray<SurveyQuestionView>,
  answers: AnswerState,
): string[] {
  return questions
    .filter((question) => {
      if (!question.required) return false;
      const answer = answers[question.code];
      if (!answer) return true;
      if (answer.kind === "text") return answer.value.trim().length === 0;
      if (answer.kind === "options") return answer.optionCodes.length === 0;
      return false;
    })
    .map((question) => question.code);
}

function toPayload(answers: AnswerState, questions: ReadonlyArray<SurveyQuestionView>) {
  const known = new Set(questions.map((question) => question.code));
  return Object.fromEntries(Object.entries(answers).filter(([code]) => known.has(code))) as Record<
    string,
    AnswerView
  >;
}

function QuestionField({
  question,
  answer,
  error,
  disabled,
  onChange,
}: {
  question: SurveyQuestionView;
  answer: AnswerView | undefined;
  error: string | undefined;
  disabled: boolean;
  onChange: (code: string, value: AnswerView | undefined) => void;
}) {
  const id = `q-${question.code}`;
  const helpId = question.helpText ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  // Both are announced with the control, so a screen reader hears the help and the failure.
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  // A group of radios or checkboxes is named by a `<legend>`; a single input is named by its own
  // `<label>`. Using a fieldset for both leaves the text, number and date controls with no
  // accessible name at all — the legend names the group, never the control inside it.
  const isGroup = isChoiceQuestion(question.type) || question.type === "BOOLEAN";

  const prompt = (
    <>
      {question.prompt}
      {question.required ? (
        // Not colour alone: the word is the signal, and it is part of the accessible name.
        <span className={styles.required}> (obligatoria)</span>
      ) : null}
    </>
  );

  const body = (
    <>
      {question.helpText ? (
        <p className={styles.help} id={helpId}>
          {question.helpText}
        </p>
      ) : null}

      <QuestionControl
        answer={answer}
        describedBy={describedBy}
        disabled={disabled}
        id={id}
        invalid={error !== undefined}
        onChange={onChange}
        question={question}
      />

      {error ? (
        <p className={styles.fieldError} id={errorId}>
          {error}
        </p>
      ) : null}
    </>
  );

  return (
    <li className={styles.question} data-question={question.code}>
      {isGroup ? (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{prompt}</legend>
          {body}
        </fieldset>
      ) : (
        <div className={styles.fieldset}>
          <label className={styles.legend} htmlFor={id}>
            {prompt}
          </label>
          {body}
        </div>
      )}
    </li>
  );
}

function QuestionControl({
  question,
  answer,
  id,
  describedBy,
  invalid,
  disabled,
  onChange,
}: {
  question: SurveyQuestionView;
  answer: AnswerView | undefined;
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  disabled: boolean;
  onChange: (code: string, value: AnswerView | undefined) => void;
}) {
  const common = {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
    "aria-required": question.required || undefined,
    disabled,
    className: styles.control,
  } as const;

  switch (question.type) {
    case "LONG_TEXT":
      return (
        <textarea
          {...common}
          className={`${styles.control} ${styles.textarea}`}
          onChange={(event) => onChange(question.code, { kind: "text", value: event.target.value })}
          rows={4}
          value={answer?.kind === "text" ? answer.value : ""}
        />
      );

    case "SHORT_TEXT":
      return (
        <input
          {...common}
          maxLength={300}
          onChange={(event) => onChange(question.code, { kind: "text", value: event.target.value })}
          type="text"
          value={answer?.kind === "text" ? answer.value : ""}
        />
      );

    case "INTEGER":
    case "DECIMAL":
      return (
        <input
          {...common}
          inputMode={question.type === "INTEGER" ? "numeric" : "decimal"}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "") return onChange(question.code, undefined);
            const value = Number(raw);
            onChange(question.code, Number.isFinite(value) ? { kind: "number", value } : undefined);
          }}
          step={question.type === "INTEGER" ? 1 : "any"}
          type="number"
          value={answer?.kind === "number" ? String(answer.value) : ""}
        />
      );

    case "DATE":
      return (
        <input
          {...common}
          onChange={(event) =>
            onChange(
              question.code,
              event.target.value === "" ? undefined : { kind: "date", value: event.target.value },
            )
          }
          type="date"
          value={answer?.kind === "date" ? answer.value : ""}
        />
      );

    case "BOOLEAN":
      return (
        <div className={styles.choices} role="radiogroup" aria-describedby={describedBy}>
          {[
            { value: true, label: "Sí" },
            { value: false, label: "No" },
          ].map((option) => (
            <label className={styles.choice} key={String(option.value)}>
              <input
                checked={answer?.kind === "boolean" && answer.value === option.value}
                disabled={disabled}
                name={id}
                onChange={() => onChange(question.code, { kind: "boolean", value: option.value })}
                type="radio"
              />
              {option.label}
            </label>
          ))}
        </div>
      );

    case "SINGLE_CHOICE":
      return (
        <div className={styles.choices} role="radiogroup" aria-describedby={describedBy}>
          {question.options.map((option) => (
            <label className={styles.choice} key={option.id}>
              <input
                checked={answer?.kind === "option" && answer.optionCode === option.code}
                disabled={disabled}
                name={id}
                onChange={() =>
                  onChange(question.code, { kind: "option", optionCode: option.code })
                }
                type="radio"
              />
              {option.label}
            </label>
          ))}
        </div>
      );

    case "MULTI_CHOICE": {
      const selected = answer?.kind === "options" ? answer.optionCodes : [];
      return (
        <div className={styles.choices}>
          {question.options.map((option) => (
            <label className={styles.choice} key={option.id}>
              <input
                checked={selected.includes(option.code)}
                disabled={disabled}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option.code]
                    : selected.filter((code) => code !== option.code);
                  onChange(question.code, { kind: "options", optionCodes: next });
                }}
                type="checkbox"
              />
              {option.label}
            </label>
          ))}
        </div>
      );
    }
  }
}
