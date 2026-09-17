import type { MessageKey, Translator } from "@eia/i18n";

/**
 * The words for stored values, in one place.
 *
 * ADR-025's rule is that *a stored value is never rendered; a label for it is*, and ADR-029 put
 * those labels in the message catalogue rather than in the domain. This module is the join: a
 * caller passes the value it holds and gets back the word the reader's locale has for it.
 *
 * Every helper is a one-line lookup on purpose. The alternative — a `switch` per surface, or a
 * `locale === "en" ? … : …` next to each badge — is how a product ends up saying *Confirmado* in
 * one table and *Confirmed* in the next.
 */
const vocabulary = (t: Translator, namespace: string, value: string): string =>
  t(`vocabulary.${namespace}.${value}` as MessageKey);

export const tenantRoleLabel = (t: Translator, value: string) => vocabulary(t, "tenantRole", value);
export const projectRoleLabel = (t: Translator, value: string) =>
  vocabulary(t, "projectRole", value);
export const regimeLabel = (t: Translator, value: string) => vocabulary(t, "regime", value);
export const originLabel = (t: Translator, value: string) => vocabulary(t, "origin", value);
export const transformationLabel = (t: Translator, value: string) =>
  vocabulary(t, "transformation", value);
export const granularityLabel = (t: Translator, value: string) =>
  vocabulary(t, "granularity", value);
export const validationStateLabel = (t: Translator, value: string) =>
  vocabulary(t, "validationState", value);
export const sourceTypeLabel = (t: Translator, value: string) => vocabulary(t, "sourceType", value);
export const sourceTypeNote = (t: Translator, value: string) =>
  vocabulary(t, "sourceTypeNote", value);
export const parcelSideLabel = (t: Translator, value: string) => vocabulary(t, "parcelSide", value);
export const parcelStatusLabel = (t: Translator, value: string) =>
  vocabulary(t, "parcelStatus", value);
export const parcelStatusNote = (t: Translator, value: string) =>
  vocabulary(t, "parcelStatusNote", value);
export const layerLegendLabel = (t: Translator, value: string) =>
  vocabulary(t, "layerLegend", value);
export const layerLegendNote = (t: Translator, value: string) =>
  vocabulary(t, "layerLegendNote", value);
export const affectationCategoryLabel = (t: Translator, value: string) =>
  vocabulary(t, "affectationCategory", value);
export const chainageMethodLabel = (t: Translator, value: string) =>
  vocabulary(t, "chainageMethod", value);
export const basemapModeLabel = (t: Translator, value: string) =>
  vocabulary(t, "basemapMode", value);
export const attentionSeverityLabel = (t: Translator, value: string) =>
  vocabulary(t, "attentionSeverity", value);
export const assignmentStatusLabel = (t: Translator, value: string) =>
  vocabulary(t, "assignmentStatus", value);
export const campaignStatusLabel = (t: Translator, value: string) =>
  vocabulary(t, "campaignStatus", value);
export const visitStatusLabel = (t: Translator, value: string) =>
  vocabulary(t, "visitStatus", value);
export const instanceStatusLabel = (t: Translator, value: string) =>
  vocabulary(t, "instanceStatus", value);
export const locationOutcomeLabel = (t: Translator, value: string) =>
  vocabulary(t, "locationOutcome", value);
export const reviewDecisionLabel = (t: Translator, value: string) =>
  vocabulary(t, "reviewDecision", value);
export const offlineModeLabel = (t: Translator, value: string) =>
  vocabulary(t, "offlineMode", value);
export const captureChannelLabel = (t: Translator, value: string) =>
  vocabulary(t, "captureChannel", value);
export const mediaKindLabel = (t: Translator, value: string) => vocabulary(t, "mediaKind", value);
export const mediaStateLabel = (t: Translator, value: string) => vocabulary(t, "mediaState", value);
export const documentKindLabel = (t: Translator, value: string) =>
  vocabulary(t, "documentKind", value);
export const textSourceLabel = (t: Translator, value: string) => vocabulary(t, "textSource", value);
export const documentProcessingLabel = (t: Translator, value: string) =>
  vocabulary(t, "documentProcessing", value);
export const documentPrivacyLabel = (t: Translator, value: string) =>
  vocabulary(t, "documentPrivacy", value);
/**
 * The AI review vocabularies (ADR-035).
 *
 * Same shape as every other vocabulary helper here: the stored value is an enum and what a reader
 * sees is a label for it (ADR-025/029). These are under `documents.review.*` rather than
 * `vocabulary.*` because they are this surface's words and are meaningless anywhere else — and
 * because a reviewer's *Descartado* must never be looked up from the same table as a quality
 * finding's, which would make the two read identically.
 */
const reviewWord = (t: Translator, group: string, value: string) =>
  t(`documents.review.${group}.${value}` as MessageKey);

export const reviewLensLabel = (t: Translator, value: string) => reviewWord(t, "lens", value);
export const reviewRunStatusLabel = (t: Translator, value: string) =>
  reviewWord(t, "status", value);
export const reviewCandidateStateLabel = (t: Translator, value: string) =>
  reviewWord(t, "state", value);
export const reviewSupportLabel = (t: Translator, value: string) => reviewWord(t, "support", value);
export const reviewSupportHelp = (t: Translator, value: string) =>
  reviewWord(t, "supportHelp", value);
export const reviewEvidenceRoleLabel = (t: Translator, value: string) =>
  reviewWord(t, "role", value);
export const reviewBlockedReasonLabel = (t: Translator, value: string) =>
  reviewWord(t, "refusedReason", value);
/** `ACCEPT` → *Aceptar*. The decision's own word, lower-cased to reach the catalogue key. */
export const reviewDecisionWord = (t: Translator, value: string) =>
  t(`documents.review.${value.toLowerCase()}` as MessageKey);

/**
 * The template library's vocabularies (ADR-036), under `templates.*` for the same reason the
 * review ones are under `documents.review.*`: they are this surface's words.
 */
const templateWord = (t: Translator, group: string, value: string) =>
  t(`templates.${group}.${value}` as MessageKey);

export const templateKindLabel = (t: Translator, value: string) =>
  templateWord(t, "kindLabel", value);
export const templateStateLabel = (t: Translator, value: string) =>
  templateWord(t, "stateLabel", value);
export const templateLocaleLabel = (t: Translator, value: string) =>
  templateWord(t, "localeLabel", value);
export const templateAbsenceLabel = (t: Translator, value: string) =>
  templateWord(t, "absenceLabel", value);
/**
 * Where a placeholder's value comes from, in the reader's language.
 *
 * The domain's `PlaceholderDefinition.source` is operator-facing English — it is what a reviewer
 * reads when asking whether a figure may be in a deliverable, and it stays in the registry. What a
 * consultant sees on the page is this label for it (ADR-025/029).
 */
export const templateSourceLabel = (t: Translator, key: string) =>
  templateWord(t, "vocabularySourceFor", key);

export const surfaceLabel = (t: Translator, key: string) =>
  t(`surface.${key === "command-center" ? "commandCenter" : key}` as MessageKey);

/**
 * `4 días` / `4 days`.
 *
 * Two keys and a choice rather than a plural engine: the product has a handful of counted phrases,
 * and a message-format language in a catalogue is a large feature nobody asked for.
 */
export function dayCount(t: Translator, count: number, formatted: string): string {
  return Math.abs(count) === 1
    ? t("common.dayOne", { count: formatted })
    : t("common.dayOther", { count: formatted });
}
