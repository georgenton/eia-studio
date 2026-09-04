import { z } from "zod";

import { InvalidInput } from "../core/errors";
import { provenanceFacetsSchema } from "../provenance/facets";

/**
 * What a report version actually is: a deterministic structure of facts, each carrying where it
 * came from (ADR-022).
 *
 * ## Why the snapshot rather than the prose
 *
 * A chapter that stores only its text turns a specialist's validated coding, a reviewer's decided
 * finding and a declared denominator into an unverifiable sentence. So the *structure* is the
 * versioned artefact: every figure is computed from validated data, recorded with its source, and
 * stored. The paragraph a model may later write is a rendering of this, and the version is complete
 * and usable without one.
 *
 * ## Why a fact cannot exist without a source
 *
 * `ReportFact` has no shape for a sourceless value. That is deliberate: traceability enforced by a
 * type is traceability that cannot be forgotten under deadline, and D4's requirement is that every
 * key statement resolves to a metric, a validated coding, a decided finding, or a cited passage.
 */
export const REPORT_KINDS = ["social_chapter"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Where a fact came from. A discriminated union, validated per kind, rendered by one component. */
export const factSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("metric"),
      /** The computation's identity, e.g. `social.tabulation`. Reproducible by name. */
      metric: z.string().min(1).max(120),
      /** How it was counted, in words a specialist can check. */
      method: z.string().min(1).max(400),
    })
    .strict(),
  z
    .object({
      kind: z.literal("human_review"),
      /** How many validated codings the figure rests on. Never a count of AI proposals. */
      reviews: z.number().int().nonnegative(),
      taxonomyVersionLabel: z.string().min(1).max(40),
    })
    .strict(),
  z
    .object({
      kind: z.literal("quality_finding"),
      findingCode: z.string().min(1).max(20),
      state: z.string().min(1).max(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal("document_chunk"),
      documentCode: z.string().min(1).max(20),
      versionLabel: z.string().min(1).max(20),
      page: z.number().int().positive().nullable(),
      chunkId: z.uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("provenance"),
      provenanceId: z.uuid(),
      facets: provenanceFacetsSchema,
      /** The one-line method or criterion the record carries. */
      note: z.string().min(1).max(400),
    })
    .strict(),
]);
export type FactSource = z.infer<typeof factSourceSchema>;

export const reportFactSchema = z
  .object({
    /** Stable within a section, so two versions' facts can be compared by key. */
    key: z.string().min(1).max(80),
    label: z.string().min(1).max(200),
    /** Already formatted for `es-EC`: the snapshot is what gets rendered, in both directions. */
    value: z.string().min(1).max(200),
    /** The denominator or qualifier the figure is only true against. */
    basis: z.string().min(1).max(300).nullable(),
    source: factSourceSchema,
  })
  .strict();
export type ReportFact = z.infer<typeof reportFactSchema>;

/**
 * The sections of the social chapter.
 *
 * Fixed rather than configurable: a chapter's shape is an editorial decision, and a project that
 * needs a different one needs a different report kind, not a settings page.
 */
export const SOCIAL_SECTIONS = [
  "universe",
  "closed_questions",
  "validated_themes",
  "quality",
  "sources",
] as const;
export type SocialSectionKey = (typeof SOCIAL_SECTIONS)[number];

export const SECTION_TITLES: Record<SocialSectionKey, string> = {
  universe: "Universo y cobertura",
  closed_questions: "Resultados de las preguntas cerradas",
  validated_themes: "Temas validados de las respuestas abiertas",
  quality: "Revisión de calidad del expediente",
  sources: "Fuentes y procedencia",
};

export const reportSectionSchema = z
  .object({
    key: z.string().min(1).max(60),
    title: z.string().min(1).max(200),
    ordinal: z.number().int().nonnegative(),
    /** What the section is about, in the product's own words. Never generated. */
    summary: z.string().min(1).max(600),
    facts: z.array(reportFactSchema),
  })
  .strict();
export type ReportSection = z.infer<typeof reportSectionSchema>;

export const reportSnapshotSchema = z
  .object({
    kind: z.enum(REPORT_KINDS),
    /** The instant every figure was computed at. A snapshot is a claim about a moment. */
    computedAt: z.iso.datetime(),
    projectName: z.string().min(1).max(200),
    /** The questionnaire version the social figures belong to. Versions are never added together. */
    surveyVersionLabel: z.string().min(1).max(40),
    sections: z.array(reportSectionSchema).min(1),
    /**
     * What the reader must know before reading a figure. Regimes present in the sources, so a
     * chapter built partly on demo simulation says so at the top rather than in a footnote.
     */
    regimes: z.array(z.string().min(1).max(40)).min(1),
  })
  .strict();
export type ReportSnapshot = z.infer<typeof reportSnapshotSchema>;

/** Every fact of a snapshot, flattened. Used by the DOCX renderer and by the traceability tests. */
export function snapshotFacts(snapshot: ReportSnapshot): ReadonlyArray<ReportFact> {
  return snapshot.sections.flatMap((section) => section.facts);
}

/**
 * A snapshot that would mislead is refused before it is stored.
 *
 * Two checks, and both exist because of a specific way a report goes wrong.
 *
 * **A validated-theme figure must rest on validated codings.** If the project has proposals and no
 * reviews, the honest output is a section saying nothing has been validated — not a distribution
 * computed from proposals. The type cannot prevent that; this can.
 *
 * **A chapter built on demo data must say so.** A snapshot whose sources include `DEMO_SIMULATION`
 * carries that regime at the top. A reader who does not know which figures are simulated has been
 * given a document that looks like a study.
 */
export function assertSnapshotHonest(snapshot: ReportSnapshot): void {
  reportSnapshotSchema.parse(snapshot);

  for (const section of snapshot.sections) {
    for (const fact of section.facts) {
      if (fact.source.kind === "human_review" && fact.source.reviews === 0 && fact.value !== "—") {
        throw new InvalidInput(
          `report_fact_without_validation: "${fact.key}" states ${fact.value} from zero validated ` +
            "codings. A theme figure rests on human_review rows; with none, the section says so.",
        );
      }
    }
  }

  const declared = new Set(snapshot.regimes);
  for (const fact of snapshotFacts(snapshot)) {
    if (fact.source.kind === "provenance" && !declared.has(fact.source.facets.regime)) {
      throw new InvalidInput(
        `report_regime_undeclared: a fact carries regime ${fact.source.facets.regime}, which the ` +
          "snapshot does not declare. A chapter built partly on simulated data says so at the top.",
      );
    }
  }
}

/** Deterministic identity of a snapshot's *content*, so two versions can be compared. */
export function snapshotDigest(snapshot: ReportSnapshot): string {
  // `computedAt` is excluded on purpose: two generations of unchanged data must be recognisable as
  // the same chapter, and the instant is not part of what the chapter says.
  const { computedAt: _computedAt, ...rest } = snapshot;
  return stableStringify(rest);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** `v1`, `v2`, … — the product's one version convention, as everywhere else. */
export function nextReportVersionLabel(existing: ReadonlyArray<string>): string {
  const highest = existing
    .map((label) => /^v(\d+)$/.exec(label)?.[1])
    .filter((digits): digits is string => digits !== undefined)
    .map(Number)
    .reduce((max, value) => Math.max(max, value), 0);
  return `v${highest + 1}`;
}
