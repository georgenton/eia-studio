import type { PackQuestion } from "@eia/field-sync-contract";
import type { Locale } from "@eia/i18n";

/**
 * A question in the technician's language — **without changing what an answer means.**
 *
 * This is the whole of C2 in one function. The prompt and the option labels are looked up per
 * locale; the question's `code`, its `type`, its options' `code`s, its ordinal and its
 * required-ness are untouched, because those are what an answer points at. Switching from Spanish
 * to English changes every word on the screen and not one byte of what is captured.
 *
 * The canonical `es-EC` wording lives on the question itself, so a version published before the
 * product became bilingual renders exactly as it always did and a locale with no translation falls
 * back to it rather than to a key.
 */
export interface LocalizedQuestion {
  readonly code: string;
  readonly prompt: string;
  readonly helpText: string | null;
  readonly options: ReadonlyArray<{ readonly code: string; readonly label: string }>;
}

export function localizeQuestion(question: PackQuestion, locale: Locale): LocalizedQuestion {
  const translated = question.translations[locale];
  return {
    code: question.code,
    prompt: translated?.prompt ?? question.prompt,
    helpText: translated?.helpText ?? question.helpText,
    options: question.options.map((option) => ({
      code: option.code,
      label: translated?.options[option.code] ?? option.label,
    })),
  };
}

/** Which languages this questionnaire can actually be read in, canonical first. */
export function availableLocales(
  questions: ReadonlyArray<PackQuestion>,
  canonical: Locale,
): ReadonlyArray<Locale> {
  const found = new Set<string>([canonical]);
  for (const question of questions) {
    for (const locale of Object.keys(question.translations)) found.add(locale);
  }
  return [...found] as ReadonlyArray<Locale>;
}
