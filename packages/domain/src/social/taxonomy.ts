import { z } from "zod";

import { InvalidInput } from "../core/errors";

/**
 * The coding scheme, and the rule that keeps a coding meaning what it meant.
 *
 * ## Taxonomy versus version versus category
 *
 * A `Taxonomy` is the scheme as a *concept* — "preocupaciones sociales viales" — a key and a name.
 * A `TaxonomyVersion` is a **definition**: the exact categories, their codes, their labels and the
 * descriptions a classifier is given. A `TaxonomyCategory` belongs to exactly one version.
 *
 * ## Why a published version is immutable
 *
 * This is the same argument as `SurveyVersion` (field/survey.ts), applied to the other side of the
 * coding: an answer coded `ACCESO_PREDIO` means whatever `ACCESO_PREDIO` meant when the coding was
 * made. Widen that category's description later and every historic coding silently acquires a
 * different meaning, with nothing in the data recording that it happened. A taxonomy *will* be
 * refined — that is what coding schemes do — so the refinement has to produce a new version rather
 * than edit the old one.
 *
 * A `DRAFT` version may be edited freely; a `PUBLISHED` one may not be edited at all; `RETIRED`
 * stays readable so old codings remain interpretable. Database triggers enforce it, because a rule
 * that lives only in a use-case is one repository call away from being bypassed.
 *
 * ## What this is not
 *
 * Not an ontology platform. No inheritance, no synonyms, no cross-version mapping, no merge
 * operations. A version is a flat, ordered list of mutually intelligible categories, which is what
 * a human coder and a classifier both actually consume.
 */
export const TAXONOMY_VERSION_STATUSES = ["DRAFT", "PUBLISHED", "RETIRED"] as const;
export const taxonomyVersionStatusSchema = z.enum(TAXONOMY_VERSION_STATUSES);
export type TaxonomyVersionStatus = z.infer<typeof taxonomyVersionStatusSchema>;

/**
 * A category code is a stable machine identifier: it appears in the model's structured output, in
 * stored classifications and in exports. Labels are Spanish product copy and may be improved
 * within a draft; codes are not renamed, because renaming one is indistinguishable from changing
 * what it means.
 */
export const categoryCodeSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/, "a category code is UPPER_SNAKE_CASE");

export const taxonomyCategorySchema = z
  .object({
    code: categoryCodeSchema,
    label: z.string().min(2).max(120),
    /**
     * What the category covers, in enough words for a coder — human or model — to decide. Sent to
     * the classifier verbatim, so it is part of the version's definition and part of its hash.
     */
    description: z.string().min(10).max(600),
    ordinal: z.number().int().min(0),
  })
  .strict();
export type TaxonomyCategoryInput = z.infer<typeof taxonomyCategorySchema>;

/** The immutable definition a classification or a review points at. */
export interface TaxonomyDefinition {
  readonly versionId: string;
  readonly versionLabel: string;
  readonly categories: ReadonlyArray<TaxonomyCategoryInput>;
}

export class TaxonomyNotPublishable extends InvalidInput {
  override readonly name = "TaxonomyNotPublishable";
}

/**
 * A version may be published when it is a coding scheme somebody could actually apply: at least
 * two categories to choose between, unique codes, unique ordinals, and an explicit residual
 * category so that "none of these" is a decision rather than an empty answer.
 */
export function assertTaxonomyVersionPublishable(
  categories: ReadonlyArray<TaxonomyCategoryInput>,
): void {
  if (categories.length < 2) {
    throw new TaxonomyNotPublishable(
      "a taxonomy version needs at least two categories; one category is not a choice",
    );
  }
  const codes = new Set<string>();
  const ordinals = new Set<number>();
  for (const category of categories) {
    if (codes.has(category.code)) {
      throw new TaxonomyNotPublishable(`duplicate category code: ${category.code}`);
    }
    if (ordinals.has(category.ordinal)) {
      throw new TaxonomyNotPublishable(`duplicate category ordinal: ${category.ordinal}`);
    }
    codes.add(category.code);
    ordinals.add(category.ordinal);
  }
  if (!codes.has(RESIDUAL_CATEGORY_CODE)) {
    throw new TaxonomyNotPublishable(
      `a taxonomy version needs the residual category ${RESIDUAL_CATEGORY_CODE}, so that ` +
        `"none of these applies" is something a coder can say`,
    );
  }
}

/**
 * The residual category. It exists so a classifier that recognises nothing has a valid answer;
 * it is never a fallback the application substitutes when validation fails — an unrecognised
 * category code is a failed classification, not an `OTHER` (see `classification.ts`).
 */
export const RESIDUAL_CATEGORY_CODE = "OTHER";

/**
 * A content hash over the definition, in the same shape as `surveyVersionHash`: FNV-1a over the
 * canonical text, so a version can be identified in a run record and in an export without
 * comparing every category row. Not a security primitive — a fingerprint.
 */
export function socialTaxonomyHash(categories: ReadonlyArray<TaxonomyCategoryInput>): string {
  const canonical = [...categories]
    .sort((a, b) => a.ordinal - b.ordinal || a.code.localeCompare(b.code))
    .map((c) => `${c.ordinal}|${c.code}|${c.label}|${c.description}`)
    .join("\n");
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Codes of a definition, for validating model output and human selections against it. */
export function categoryCodes(definition: TaxonomyDefinition): ReadonlySet<string> {
  return new Set(definition.categories.map((c) => c.code));
}

export class UnknownCategory extends InvalidInput {
  override readonly name = "UnknownCategory";
  constructor(code: string, versionLabel: string) {
    super(
      `category ${code} does not belong to taxonomy version ${versionLabel}; a coding may only ` +
        `use categories of the version it was made against`,
    );
  }
}

/**
 * Every selected code must belong to this exact version. Used for model output and for a
 * specialist's final labels alike: the same rule, because both are codings against one definition.
 */
export function assertCategoriesBelong(
  definition: TaxonomyDefinition,
  codes: ReadonlyArray<string>,
): void {
  const known = categoryCodes(definition);
  for (const code of codes) {
    if (!known.has(code)) throw new UnknownCategory(code, definition.versionLabel);
  }
}
