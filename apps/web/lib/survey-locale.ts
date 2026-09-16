import type { SurveyQuestionView } from "@eia/application";
import type { Locale } from "@eia/i18n";

/**
 * The questionnaire, in the reader's language — without becoming a different questionnaire.
 *
 * One `SurveyVersion` carries every language it was published in (ADR-029): the translations are
 * rows keyed by question and option **code**, and the codes are what an answer points at. So this
 * changes the words and nothing else. A technician answering in English and a specialist reading
 * the tabulation in Spanish are looking at the same response.
 *
 * A question nobody translated keeps its canonical Spanish wording rather than disappearing: a
 * missing translation is a gap in the wording, never a gap in the form.
 */
export interface LocalizedQuestion extends SurveyQuestionView {
  readonly options: ReadonlyArray<{ id: string; code: string; label: string; ordinal: number }>;
}

export function localizeQuestion(question: SurveyQuestionView, locale: Locale): LocalizedQuestion {
  const translated = question.translations[locale];
  const optionLabels = question.optionTranslations[locale] ?? {};
  if (!translated && Object.keys(optionLabels).length === 0) return question;
  return {
    ...question,
    prompt: translated?.prompt ?? question.prompt,
    helpText: translated?.helpText ?? question.helpText,
    options: question.options.map((option) => ({
      ...option,
      label: optionLabels[option.code] ?? option.label,
    })),
  };
}
