import { InvalidInput } from "../core/errors";

/**
 * Reading a delivered file, and the three things this module refuses to invent.
 *
 * ## A locator is what a citation points at, and it is not always a page
 *
 * A PDF has printed pages, and a citation that names one can be checked by opening the file and
 * turning to it. **A DOCX has no such thing.** Its pagination is computed by whatever renders it —
 * from the fonts installed, the paper size, the printer driver — so two readers of the same file
 * can disagree about what is on page 7. Numbering chunks 1, 2, 3 and calling those pages would
 * produce citations that look verifiable and are not, which is exactly the fabrication ADR-020
 * refused when it kept page numbers out of quality evidence.
 *
 * So a chunk's locator declares its **kind**, and the surfaces render accordingly:
 *
 * | Kind | Means | Produced by |
 * |---|---|---|
 * | `PAGE` | a printed page number, as the file paginates itself | PDF extraction |
 * | `SECTION` | the heading trail a paragraph sits under | DOCX extraction |
 *
 * ## A scanned PDF has no text, and this product does not guess what it says
 *
 * A PDF of photographed pages carries no characters — or carries a handful from a header stamp.
 * Running it through a text extractor yields a few words of noise, which chunked and indexed would
 * become a document that *appears* searchable and answers nothing. `REQUIRES_OCR` is the honest
 * terminal state: the file stays, the surface says why, and nobody is shown a passage that is not
 * in the document.
 */
export const CHUNK_LOCATOR_KINDS = ["PAGE", "SECTION"] as const;
export type ChunkLocatorKind = (typeof CHUNK_LOCATOR_KINDS)[number];

/* A locator kind's words are `vocabulary.locatorKind.*` in `@eia/i18n` (ADR-029). */

/**
 * One unit of a file as extraction found it.
 *
 * A PDF page, or a DOCX paragraph under its headings. `text` is what was actually read; nothing
 * here normalises spelling, repairs a table or fills a gap — a delivered document's own errors are
 * findings to report, not defects to repair (the rule Wave C established for the management plan).
 */
export interface ExtractedUnit {
  /** 1-based page number for a PDF; the paragraph's position for a DOCX. */
  readonly ordinal: number;
  readonly kind: ChunkLocatorKind;
  /** The heading trail, for `SECTION`. Null for a page. */
  readonly sectionPath: string | null;
  readonly text: string;
}

export interface ExtractionResult {
  readonly units: ReadonlyArray<ExtractedUnit>;
  readonly kind: ChunkLocatorKind;
  /** Pages, for a PDF. Zero for a DOCX, which has none this product can know. */
  readonly pageCount: number;
}

/**
 * Whether a PDF carried enough native text to be read, or is a scan.
 *
 * Two questions, and both have to pass. **Enough characters overall**, because a 90-page study
 * with 40 characters in it is a scan with a header stamp. And **enough pages that carry any text
 * at all**, because a born-digital cover page in front of 200 scanned ones would pass a total-only
 * test on the strength of its title.
 *
 * The thresholds are deliberately generous: this decides between *reading a document* and *telling
 * a person to OCR it*, and being wrong in the cautious direction costs a re-run, while being wrong
 * the other way puts noise in the corpus under a citation.
 */
export const OCR_THRESHOLDS = {
  /** Below this many characters across the whole file, it is not text. */
  minTotalCharacters: 200,
  /** Below this share of pages carrying any meaningful text, it is not text. */
  minPagesWithTextRatio: 0.25,
  /** A page with fewer than this many characters counts as carrying none. */
  minCharactersPerPage: 40,
} as const;

export interface NativeTextAssessment {
  readonly hasNativeText: boolean;
  readonly totalCharacters: number;
  readonly pagesWithText: number;
  readonly pageCount: number;
  /** Why not, when not — a code the catalogue has words for, never a sentence. */
  readonly reason: "SCANNED_OR_IMAGE_ONLY" | "TOO_LITTLE_TEXT" | null;
}

export function assessNativeText(pages: ReadonlyArray<string>): NativeTextAssessment {
  const trimmed = pages.map((page) => page.replace(/\s+/gu, " ").trim());
  const totalCharacters = trimmed.reduce((sum, page) => sum + page.length, 0);
  const pagesWithText = trimmed.filter(
    (page) => page.length >= OCR_THRESHOLDS.minCharactersPerPage,
  ).length;
  const pageCount = pages.length;

  if (pageCount === 0) {
    return {
      hasNativeText: false,
      totalCharacters: 0,
      pagesWithText: 0,
      pageCount: 0,
      reason: "SCANNED_OR_IMAGE_ONLY",
    };
  }
  if (totalCharacters < OCR_THRESHOLDS.minTotalCharacters) {
    return {
      hasNativeText: false,
      totalCharacters,
      pagesWithText,
      pageCount,
      reason: pagesWithText === 0 ? "SCANNED_OR_IMAGE_ONLY" : "TOO_LITTLE_TEXT",
    };
  }
  if (pagesWithText / pageCount < OCR_THRESHOLDS.minPagesWithTextRatio) {
    // A born-digital cover in front of two hundred scanned pages. The total passes; the document
    // is still a scan, and the citations it would produce would come from one page of it.
    return {
      hasNativeText: false,
      totalCharacters,
      pagesWithText,
      pageCount,
      reason: "SCANNED_OR_IMAGE_ONLY",
    };
  }
  return { hasNativeText: true, totalCharacters, pagesWithText, pageCount, reason: null };
}

/**
 * The states a delivered file moves through, and the two that are terminal without success.
 *
 * `UPLOADED` is the file stored and nobody yet asked for it to be read — an observable state, not
 * a formality: a version whose enqueue failed sits here and a person can ask again.
 */
export const DOCUMENT_PROCESSING_TRANSITIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  UPLOADED: ["QUEUED"],
  QUEUED: ["PROCESSING"],
  PROCESSING: ["READY", "REQUIRES_OCR", "FAILED"],
  // A re-run after a fix — a corrected file is a new version, but a transient failure is worth
  // retrying against the same bytes.
  FAILED: ["QUEUED"],
  REQUIRES_OCR: ["QUEUED"],
  READY: [],
};

export function assertProcessingTransition(from: string, to: string): void {
  const allowed = DOCUMENT_PROCESSING_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new InvalidInput(`a document version cannot go from ${from} to ${to}`);
  }
}

/**
 * A heading trail, bounded and cleaned.
 *
 * Bounded because it is stored on every chunk and rendered inside a citation; cleaned because a
 * DOCX's heading text arrives with whatever whitespace the author left in it. The words themselves
 * are the document's and are never rewritten.
 */
export const MAX_SECTION_PATH = 300;

export function sectionPath(headings: ReadonlyArray<string>): string | null {
  const parts = headings
    .map((heading) => heading.replace(/\s+/gu, " ").trim())
    .filter((heading) => heading.length > 0);
  if (parts.length === 0) return null;
  const joined = parts.join(" › ");
  return joined.length <= MAX_SECTION_PATH ? joined : `… ${joined.slice(-(MAX_SECTION_PATH - 2))}`;
}
