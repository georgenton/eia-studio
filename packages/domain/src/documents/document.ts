import { z } from "zod";

import { InvalidInput } from "../core/errors";

/**
 * A project's documents, and the rule that keeps a citation meaning what it meant.
 *
 * `SourceDocument` is the document as a *thing* — "Informe social", `DOC-002`. A `DocumentVersion`
 * is a **file**: its extracted text, its chunks, its hash. A newer file is a new version, never an
 * edit, for exactly the reason a published `SurveyVersion` and a published `TaxonomyVersion` are
 * immutable: a finding raised in March cited words, and those words must still be there in June.
 *
 * The current version is a pointer on the document; every citation names a version explicitly, so
 * moving the pointer never moves a citation.
 */
export const DOCUMENT_KINDS = ["report", "annex", "minutes", "plan", "legal", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/* A kind's words are `vocabulary.documentKind.*` in `@eia/i18n` (ADR-029). */

/**
 * How the text of a version got here.
 *
 * `RECONSTRUCTED_EXCERPT` is the pilot's whole corpus today: excerpts transcribed by hand from the
 * concluded study's documents. The original PDFs are external source material and are deliberately
 * not in the repository. Labelling those excerpts as an extraction from an ingested file would be
 * the same fabrication ADR-020 refused for page numbers, one layer up.
 */
export const TEXT_SOURCES = [
  "RECONSTRUCTED_EXCERPT",
  "PLAIN_TEXT",
  "PDF_TEXT",
  "DOCX_TEXT",
  /** Uploaded, not yet read. Naming a format whose text nobody has seen would be the fabrication. */
  "PENDING_EXTRACTION",
] as const;
export type TextSource = (typeof TEXT_SOURCES)[number];

/* A text source's words are `vocabulary.textSource.*` in `@eia/i18n` (ADR-029). */

/**
 * Where an uploaded file has got to (ADR-031).
 *
 * `REQUIRES_OCR` is terminal and honest: a scanned PDF has no native text and this product does
 * not invent any. The file stays available, and the surface says which of the six this is.
 */
export const DOCUMENT_PROCESSING_STATES = [
  "UPLOADED",
  "QUEUED",
  "PROCESSING",
  "READY",
  "REQUIRES_OCR",
  "FAILED",
] as const;
export type DocumentProcessingState = (typeof DOCUMENT_PROCESSING_STATES)[number];

/**
 * What is known about personal data in a version — a **claim somebody made**, never a fact this
 * product derived.
 *
 * `REVIEW_REQUIRED` is the default for an uploaded file, and deliberately not "none known": at
 * that point nothing has been read, and a green state nobody checked is the one that would later
 * be quoted. Only `NO_PERSONAL_DATA_KNOWN` is eligible to leave for an AI provider.
 */
export const DOCUMENT_PRIVACY_CLASSIFICATIONS = [
  "NO_PERSONAL_DATA_KNOWN",
  "CONTAINS_PERSONAL_DATA",
  "REVIEW_REQUIRED",
] as const;
export type DocumentPrivacyClassification = (typeof DOCUMENT_PRIVACY_CLASSIFICATIONS)[number];

/** `DOC-001`, per project. A business identifier, never a primary key. */
const DOCUMENT_CODE = /^DOC-\d{3,}$/;

export function assertDocumentCode(code: string): void {
  if (!DOCUMENT_CODE.test(code)) {
    throw new InvalidInput(`a document code looks like DOC-001; got "${code}"`);
  }
}

export const ingestDocumentSchema = z
  .object({
    code: z.string().regex(DOCUMENT_CODE),
    title: z.string().trim().min(3).max(300),
    kind: z.enum(DOCUMENT_KINDS),
    versionLabel: z.string().trim().min(1).max(20),
    textSource: z.enum(TEXT_SOURCES),
    /**
     * Whether this document is known to contain identified personal data. Slice 6 refuses to ingest
     * one at all: the redaction pipeline is not built, and a chunk of an unredacted document is
     * exactly what must never become retrievable text (SECURITY.md §8).
     */
    containsPii: z.boolean().default(false),
    pages: z
      .array(z.object({ number: z.number().int().positive(), text: z.string().min(1) }).strict())
      .min(1),
    /** Human-readable origin, printed beside every citation of this version. */
    sourceNote: z.string().trim().min(3).max(400),
  })
  .strict();
export type IngestDocumentInput = z.infer<typeof ingestDocumentSchema>;

/**
 * A document flagged as containing identified personal data is refused, not redacted.
 *
 * Redaction before chunking is the approved path (AI_GOVERNANCE.md §4), and it is not built. The
 * alternative to refusing is chunking the text and hoping nobody retrieves the wrong paragraph,
 * which is not a control. The gate is here, on the path every ingestion takes.
 */
export class DocumentContainsPii extends InvalidInput {
  constructor(code: string) {
    super(
      `document_contains_pii: ${code} is flagged as containing identified personal data. ` +
        "Ingestion is refused: the deidentification pipeline that would let its text be chunked " +
        "and retrieved does not exist yet (AI_GOVERNANCE.md §4, SECURITY.md §10a).",
    );
    this.name = "DocumentContainsPii";
  }
}

export function assertIngestable(input: { code: string; containsPii: boolean }): void {
  if (input.containsPii) throw new DocumentContainsPii(input.code);
}

/**
 * The next version label for a document, when the caller does not supply one.
 *
 * `v1`, `v2`, … — the same shape as a survey version and a taxonomy version, because they are the
 * same idea and a reader should not have to learn three conventions.
 */
export function nextVersionLabel(existing: ReadonlyArray<string>): string {
  const highest = existing
    .map((label) => /^v(\d+)$/.exec(label)?.[1])
    .filter((digits): digits is string => digits !== undefined)
    .map(Number)
    .reduce((max, value) => Math.max(max, value), 0);
  return `v${highest + 1}`;
}
