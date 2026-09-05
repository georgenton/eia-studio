import { z } from "zod";

/**
 * What a finding points at.
 *
 * The problem this solves: a finding can compare a number in a report against a count in the GIS
 * layer, a date in a plan against a date in a minute, a place name in a document against the
 * project's own territory. Foreign keys to every one of those tables would couple the quality
 * module to every other module's schema — and would still not express "page 47 of version 3".
 *
 * So evidence carries a **typed locator**: a discriminated union, validated per kind, rendered by
 * one component, resolvable to a destination. Adding a rule that cites something new adds a
 * variant here; it does not add a column anywhere.
 */
export const EVIDENCE_ROLES = ["SOURCE_A", "SOURCE_B", "CONTEXT"] as const;
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

/**
 * An extracted statement from the study corpus (Slice 5's substrate, ADR-020 §5).
 *
 * Until documents are ingested this is what a document-borne claim looks like: a value somebody
 * read out of the corpus, with the human-readable reference they read it from. It carries **no
 * page number**, because we cannot honestly produce one before ingestion, and a fabricated page
 * in the one field whose purpose is verification would be the worst possible thing to invent.
 */
const assertionLocator = z
  .object({
    kind: z.literal("assertion"),
    assertionId: z.uuid(),
    /** Human-readable, as printed on screen: "Informe social · anexo de afectaciones". */
    sourceRef: z.string().min(1).max(200),
  })
  .strict();

/** Something the project itself declares: its territory, its profile, its dates. */
const projectLocator = z
  .object({
    kind: z.literal("project"),
    field: z.string().min(1).max(120),
  })
  .strict();

/**
 * A specific version of an ingested document. **Slice 6.** Declared now so that the union does not
 * have to change shape when ingestion lands, and so that a Slice 5 finding enriched later gains a
 * locator rather than being rewritten.
 */
const documentLocator = z
  .object({
    kind: z.literal("document_version"),
    documentVersionId: z.uuid(),
    page: z.number().int().positive().optional(),
    chunkId: z.uuid().optional(),
  })
  .strict();

/**
 * One plan of the management plan chapter (ADR-024).
 *
 * The plan is named by its own code and title rather than by a row id, because that is how a
 * specialist finds it in the chapter — and because a re-import gives the plan a new row while the
 * finding it produced must keep pointing at the same plan (ADR-026 applies the same reasoning to
 * campaigns).
 */
const pgasPlanLocator = z
  .object({
    kind: z.literal("pgas_plan"),
    planCode: z.string().min(1).max(40).nullable(),
    planTitle: z.string().min(1).max(300),
  })
  .strict();

/**
 * What the project's cartography does — or does not — contain.
 *
 * The absence of a layer is a legitimate side of a comparison: a plan that names an area of
 * influence the map does not hold is a disagreement between a document and the geometry delivered
 * with it. The locator names the layer, never a feature id, because "there is no such feature" is
 * precisely the case it has to be able to express.
 */
const spatialLayerLocator = z
  .object({
    kind: z.literal("spatial_layer"),
    layer: z.string().min(1).max(60),
    /** What the layer holds today, in the words the map's legend uses. */
    present: z.array(z.string().min(1).max(120)).max(20),
  })
  .strict();

export const evidenceLocatorSchema = z.discriminatedUnion("kind", [
  assertionLocator,
  projectLocator,
  documentLocator,
  pgasPlanLocator,
  spatialLayerLocator,
]);
export type EvidenceLocator = z.infer<typeof evidenceLocatorSchema>;

export const evidenceSchema = z
  .object({
    role: z.enum(EVIDENCE_ROLES),
    locator: evidenceLocatorSchema,
    /** What this side of the comparison is, in the specialist's language. */
    label: z.string().min(1).max(200),
    /** The value or the words themselves, shown verbatim beside the label. */
    quote: z.string().min(1).max(2000),
  })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * A finding shows two sides. One is not a comparison; three or more is a report.
 *
 * `CONTEXT` items are unlimited and carry the supporting material — but a finding with no
 * `SOURCE_A` and `SOURCE_B` is a claim without a comparison, which is exactly what this module
 * exists not to produce.
 */
export function assertComparable(evidence: ReadonlyArray<Evidence>): void {
  const a = evidence.filter((item) => item.role === "SOURCE_A").length;
  const b = evidence.filter((item) => item.role === "SOURCE_B").length;
  if (a !== 1 || b !== 1) {
    throw new Error(
      `a finding compares exactly two sources: found ${a} SOURCE_A and ${b} SOURCE_B. ` +
        "Supporting material belongs in CONTEXT.",
    );
  }
}
