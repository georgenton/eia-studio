import { z } from "zod";

import { InvalidInput } from "../core/errors";

/**
 * Finding the passages that bear on a question, and saying honestly how they were found.
 *
 * ## One strategy, named on screen
 *
 * The shipped implementation is PostgreSQL full-text search (ADR-021). There is no embedding
 * provider configured anywhere, and a vector column filled by a deterministic stand-in would be
 * indistinguishable from one a model produced — the artefact IG4-001 exists to prevent, one slice
 * later and in a column. So the port carries a `strategy` label and the surface prints it: a reader
 * is told *these passages contain these words*, not led to believe a model understood the question.
 *
 * When embeddings can be real, a second adapter implements this same interface. Nothing about the
 * documents, the chunks or existing citations changes.
 *
 * ## What a retriever is not allowed to be
 *
 * It has no tools, no browsing and no writes. It takes a question and a scope, and returns passages
 * that already exist. Scope is not advisory: the adapter receives the tenant and project from a
 * verified context and the row-level policies apply underneath, so a retriever that ignored its
 * arguments would still return nothing from another tenant.
 */
export const RETRIEVAL_STRATEGIES = ["full-text"] as const;
export type RetrievalStrategy = (typeof RETRIEVAL_STRATEGIES)[number];

/*
 * What the surface says about each strategy is `documents.retrievalStrategy.*` and
 * `documents.retrievalStrategyHelp.*` in `@eia/i18n`. The strategy *name* is the claim that must
 * not be over-stated, and it is the enum above; the sentence explaining it is copy.
 */

export const retrievalQuerySchema = z
  .object({
    /** The question, as the person typed it. Never rewritten by a model before searching. */
    question: z.string().trim().min(3).max(500),
    limit: z.number().int().min(1).max(20).default(6),
    /** Narrow to one document when the reader already knows where to look. */
    documentId: z.uuid().optional(),
    /**
     * Narrow to a declared set of versions (ADR-035).
     *
     * AI document review reads a corpus somebody chose and a privacy gate cleared, so the
     * retrieval that feeds it must be bounded by that same set rather than by the project. Absent
     * for the assistant, which searches the project's current corpus.
     */
    documentVersionIds: z.array(z.uuid()).min(1).max(200).optional(),
  })
  .strict();
export type RetrievalQuery = z.infer<typeof retrievalQuerySchema>;

/**
 * One passage, with everything a citation needs.
 *
 * The version is part of the identity, not decoration: a chunk belongs to exactly one
 * `DocumentVersion`, and a citation that named only the document would silently start pointing at
 * different words the next time somebody uploaded a corrected file.
 */
export interface RetrievedPassage {
  readonly chunkId: string;
  readonly documentId: string;
  readonly documentCode: string;
  readonly documentTitle: string;
  readonly documentVersionId: string;
  readonly versionLabel: string;
  readonly ordinal: number;
  /** What this passage's locator *is*. A DOCX has no page model (ADR-033). */
  readonly locatorKind: "PAGE" | "SECTION";
  readonly pageFrom: number | null;
  readonly pageTo: number | null;
  /** The heading trail, for a `SECTION` passage. */
  readonly sectionPath: string | null;
  readonly text: string;
  /** Strategy-specific and comparable only within one result set. Never shown as a percentage. */
  readonly score: number;
}

export interface RetrievalResult {
  readonly strategy: RetrievalStrategy;
  readonly passages: ReadonlyArray<RetrievedPassage>;
}

export interface DocumentRetriever {
  readonly strategy: RetrievalStrategy;
  retrieve(query: RetrievalQuery): Promise<RetrievalResult>;
}

/**
 * A citation, as it is stored and as it is rendered.
 *
 * `quote` is the passage's own words, never a paraphrase: a citation whose quoted text was
 * generated is the thing this whole layer exists to make impossible.
 */
export interface Citation {
  readonly documentCode: string;
  readonly documentTitle: string;
  readonly versionLabel: string;
  readonly documentVersionId: string;
  readonly chunkId: string;
  /**
   * Which passage, 1-based. Two passages of the same document can sit on the same page, and a
   * citation that named only the page would render two different quotes identically — a reader
   * could not tell which one a sentence rested on.
   */
  readonly passage: number;
  readonly page: number | null;
  /** Present instead of a page when the source has no pages a reader could turn to. */
  readonly section: string | null;
  readonly quote: string;
}

export function citationFor(passage: RetrievedPassage): Citation {
  return {
    documentCode: passage.documentCode,
    documentTitle: passage.documentTitle,
    versionLabel: passage.versionLabel,
    documentVersionId: passage.documentVersionId,
    chunkId: passage.chunkId,
    passage: passage.ordinal + 1,
    // A chunk spanning two pages cannot honestly name one, so it names none — and a DOCX passage
    // never names one at all, because the file has no pages this product could know.
    page:
      passage.locatorKind === "PAGE" && passage.pageFrom === passage.pageTo
        ? passage.pageFrom
        : null,
    section: passage.locatorKind === "SECTION" ? passage.sectionPath : null,
    quote: passage.text,
  };
}

/**
 * How a citation reads: `DOC-002 v1 · p. 3 · pasaje 2`.
 *
 * The version is always present, and so is the passage — it is the unit the citation actually
 * names. The page appears only when the passage sits on exactly one.
 */
export function renderCitation(citation: Citation): string {
  // A page when there is one, the heading trail when the source has no pages, and neither when a
  // passage spans two pages — in which case the passage number is what the reader checks.
  const locator =
    citation.page !== null
      ? ` · p. ${citation.page}`
      : citation.section !== null
        ? ` · ${citation.section}`
        : "";
  return `${citation.documentCode} ${citation.versionLabel}${locator} · pasaje ${citation.passage}`;
}

/**
 * Every claim a generated answer makes must rest on a passage that was actually retrieved.
 *
 * The failure this prevents is the one that makes a RAG product worse than no product: an answer
 * that cites `DOC-002 p. 7` because a model produced a plausible-looking reference. The generator
 * is given the passages and told to cite by index; an index outside the set is a **failed**
 * answer, never silently dropped, because a dropped citation leaves the sentence standing and
 * looking sourced.
 */
export function resolveCitedIndices(
  indices: ReadonlyArray<number>,
  passages: ReadonlyArray<RetrievedPassage>,
): ReadonlyArray<RetrievedPassage> {
  if (indices.length === 0) {
    throw new InvalidInput("an answer must cite at least one retrieved passage");
  }
  const resolved: RetrievedPassage[] = [];
  for (const index of indices) {
    const passage = passages[index];
    if (!passage) {
      throw new InvalidInput(
        `the answer cited passage ${index}, which was not retrieved. A citation that cannot be ` +
          "resolved is refused rather than dropped: dropping it would leave the sentence standing " +
          "and looking sourced.",
      );
    }
    if (!resolved.some((existing) => existing.chunkId === passage.chunkId)) resolved.push(passage);
  }
  return resolved;
}
