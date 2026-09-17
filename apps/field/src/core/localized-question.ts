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
  /** The heading this question is read under, in this language, or null (ADR-037). */
  readonly section: string | null;
  readonly options: ReadonlyArray<{ readonly code: string; readonly label: string }>;
}

export function localizeQuestion(question: PackQuestion, locale: Locale): LocalizedQuestion {
  const translated = question.translations[locale];
  return {
    code: question.code,
    prompt: translated?.prompt ?? question.prompt,
    helpText: translated?.helpText ?? question.helpText,
    // Falls back to the canonical heading for the same reason the prompt does: a blank heading
    // above a run of questions reads as a grouping somebody forgot to name.
    section: translated?.section ?? question.section,
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

export interface LocalizedSection {
  readonly section: string | null;
  readonly questions: ReadonlyArray<LocalizedQuestion>;
}

/**
 * The questionnaire as it is read: headings in question order, each with the run under it.
 *
 * The grouping is computed from the questions rather than sent as a structure, so the phone and
 * the authoring preview derive it the same way from the same field — and a heading can never
 * disagree with the questions it claims to hold.
 */
export function localizedSections(
  questions: ReadonlyArray<PackQuestion>,
  locale: Locale,
): ReadonlyArray<LocalizedSection> {
  const groups: Array<{ section: string | null; questions: LocalizedQuestion[] }> = [];
  for (const question of [...questions].sort((a, b) => a.ordinal - b.ordinal)) {
    const localized = localizeQuestion(question, locale);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.section === localized.section) {
      last.questions.push(localized);
    } else {
      groups.push({ section: localized.section, questions: [localized] });
    }
  }
  return groups;
}
