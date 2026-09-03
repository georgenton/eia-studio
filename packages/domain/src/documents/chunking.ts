import { createHash } from "node:crypto";
import { z } from "zod";

import { InvalidInput } from "../core/errors";

/**
 * Turning a document's extracted text into the units a citation can point at.
 *
 * ## Why this is deterministic, and versioned
 *
 * A citation names a chunk. If the same text could be chunked two ways, a citation made in March
 * would point somewhere else in June — silently, with nothing in the data recording that the ground
 * moved. So chunking is a pure function of (text, strategy version), the strategy version is stored
 * on the `DocumentVersion`, and chunks are immutable once written. Re-chunking is not a discouraged
 * operation; it is an impossible one. A different strategy produces a new document version.
 *
 * ## Why paragraphs rather than tokens
 *
 * A chunk is what a specialist will be shown as *the passage that says this*, so its boundaries
 * have to be ones a reader recognises. Paragraphs are those boundaries in the documents this
 * product reads — reports, annexes, minutes. A fixed token window would cut sentences in half and
 * make every quote look mangled, which matters more here than retrieval nicety: the quote is the
 * evidence.
 *
 * Paragraphs that are too small to be evidence on their own are merged forward until the chunk
 * reaches a floor; paragraphs longer than the ceiling are split at sentence boundaries, and only if
 * that fails, at the ceiling itself.
 */
export const CHUNKING_STRATEGY = "paragraph-merge@1";

/** Characters, not tokens: the text is Spanish prose and the units are for a human to read. */
const MIN_CHUNK = 240;
const MAX_CHUNK = 1600;

export interface DocumentPage {
  /** 1-based, as printed. A source with no pagination declares page 1 for everything. */
  readonly number: number;
  readonly text: string;
}

export interface TextChunk {
  readonly ordinal: number;
  readonly pageFrom: number;
  readonly pageTo: number;
  readonly text: string;
  /** Character offset of this chunk within the concatenated document text. */
  readonly charFrom: number;
  readonly charTo: number;
  /** sha256 of the chunk's text. Two chunks with the same hash hold the same words. */
  readonly contentHash: string;
}

export const documentPageSchema = z
  .object({ number: z.number().int().positive(), text: z.string() })
  .strict();

export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Split one document's pages into chunks.
 *
 * The offsets are into the document's own concatenated text (pages joined by a blank line), which
 * is what makes them comparable across chunks of the same version and meaningless across versions —
 * exactly the right scope for a locator.
 */
export function chunkDocument(pages: ReadonlyArray<DocumentPage>): ReadonlyArray<TextChunk> {
  if (pages.length === 0) throw new InvalidInput("a document version needs at least one page");
  for (const page of pages) documentPageSchema.parse(page);

  const paragraphs: Array<{ text: string; page: number; from: number }> = [];
  let cursor = 0;
  for (const page of pages) {
    const normalised = page.text.replace(/\r\n/g, "\n");
    let offsetInPage = 0;
    for (const raw of normalised.split(/\n{2,}/)) {
      const start = normalised.indexOf(raw, offsetInPage);
      offsetInPage = start + raw.length;
      const text = raw.trim();
      if (text.length > 0) {
        // The offset points at the trimmed text's start, so a quote can be located exactly.
        paragraphs.push({ text, page: page.number, from: cursor + start + raw.indexOf(text) });
      }
    }
    cursor += normalised.length + 2; // the blank line joining pages
  }
  if (paragraphs.length === 0) throw new InvalidInput("this document version has no text");

  const chunks: TextChunk[] = [];
  let buffer: { text: string; pageFrom: number; pageTo: number; from: number } | null = null;

  const flush = () => {
    if (!buffer) return;
    const text = buffer.text.trim();
    if (text.length === 0) {
      buffer = null;
      return;
    }
    chunks.push({
      ordinal: chunks.length,
      pageFrom: buffer.pageFrom,
      pageTo: buffer.pageTo,
      text,
      charFrom: buffer.from,
      charTo: buffer.from + text.length,
      contentHash: contentHash(text),
    });
    buffer = null;
  };

  for (const paragraph of paragraphs) {
    for (const piece of splitLong(paragraph.text)) {
      if (!buffer) {
        buffer = {
          text: piece,
          pageFrom: paragraph.page,
          pageTo: paragraph.page,
          from: paragraph.from,
        };
      } else {
        buffer.text = `${buffer.text}\n\n${piece}`;
        buffer.pageTo = paragraph.page;
      }
      if (buffer.text.length >= MIN_CHUNK) flush();
    }
  }
  // A trailing fragment below the floor is still evidence; it joins the previous chunk rather than
  // becoming a chunk nobody would accept as a quote — unless it is the only one there is.
  if (buffer) {
    const tail = buffer.text.trim();
    const previous = chunks[chunks.length - 1];
    if (previous && tail.length < MIN_CHUNK) {
      const merged = `${previous.text}\n\n${tail}`;
      chunks[chunks.length - 1] = {
        ...previous,
        text: merged,
        pageTo: buffer.pageTo,
        charTo: previous.charFrom + merged.length,
        contentHash: contentHash(merged),
      };
      buffer = null;
    } else {
      flush();
    }
  }

  return chunks;
}

/** Split a paragraph that exceeds the ceiling, preferring sentence ends. */
function splitLong(text: string): ReadonlyArray<string> {
  if (text.length <= MAX_CHUNK) return [text];
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHUNK) {
    const window = rest.slice(0, MAX_CHUNK);
    const sentence = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("? "),
      window.lastIndexOf("! "),
    );
    const cut = sentence > MIN_CHUNK ? sentence + 1 : MAX_CHUNK;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) pieces.push(rest);
  return pieces;
}
