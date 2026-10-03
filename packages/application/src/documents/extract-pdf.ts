import { assessNativeText, type ExtractionResult, type NativeTextAssessment } from "@eia/domain";

/**
 * Reading a PDF's own text, page by page (ADR-033).
 *
 * ## Why pdf.js, and why the legacy build
 *
 * A PDF's text is not a string in the file: it is a sequence of glyph-positioning operators inside
 * content streams, with the mapping back to characters living in the font objects. Writing that by
 * hand is re-implementing a PDF renderer. `pdf.js` is Mozilla's, is what Firefox uses, and — the
 * property that matters here — reports text **per page**, so a citation names the page the reader
 * will turn to rather than a chunk index somebody called a page.
 *
 * The `legacy` build is the one that runs on Node without a DOM.
 *
 * ## Why a canvas package is a dependency of text extraction
 *
 * It should not be, and for a while this comment claimed it was not: rendering is never asked
 * for, only `getTextContent()`. That turned out to be false for pdfjs-dist 5.4.149, and the way
 * it is false is worth keeping. Evaluating `pdfjs-dist/legacy/build/pdf.mjs` runs its canvas
 * module's top-level initializers, one of which is `new DOMMatrix()`. Node provides no
 * `DOMMatrix`; pdf.js obtains it from `@napi-rs/canvas`, its own `optionalDependencies` entry,
 * and when that package is missing it prints three "cannot polyfill" warnings and then throws
 * `ReferenceError: DOMMatrix is not defined` — at **import**, before any file is read.
 *
 * So `@napi-rs/canvas` is declared in this package's dependencies, exactly, rather than inherited
 * as somebody else's optional one. It was inherited for a long time, which is why it was present
 * in the workspace, present in CI, and absent from the published image — where extraction failed
 * on every PDF while every test passed. `apps/worker/tsup.config.ts` and the Dockerfile carry the
 * packaging half of that story; `apps/worker/src/pdf-smoke.ts` is what now asks the image itself.
 *
 * Nothing is rendered either way. The dependency buys one global, and the alternative — defining
 * `DOMMatrix` ourselves so the library believes a DOM exists — was rejected: a stand-in that
 * satisfies an import is indistinguishable from the real thing until a code path does arithmetic
 * with it, and then the failure is wrong text rather than an error.
 *
 * ## What is deliberately switched off
 *
 * `isEvalSupported: false`: a delivered PDF is a file somebody sent us, and a PDF is a format
 * with a scripting layer. Nothing in it is executed, no font is fetched from a network, and no
 * external resource is resolved.
 *
 * Not switched off, contrary to an earlier reading of this file: pdf.js still sets up a **worker**
 * — a "fake" one, on this thread, which it creates by importing `pdf.worker.mjs` from beside
 * `pdf.mjs`. There is no supported way to run without it, so the packaging has to keep those two
 * files as siblings; bundling pdf.js moved one of them and not the other.
 */
export interface PdfExtraction extends ExtractionResult {
  readonly assessment: NativeTextAssessment;
}

/**
 * The most a single file may consume before this is a denial of service rather than a document.
 *
 * A PDF's page count is not bounded by its size — a malformed or hostile file can declare a great
 * many — and extraction holds each page's text in memory.
 */
export const PDF_LIMITS = {
  maxPages: 2_000,
  maxCharacters: 12_000_000,
} as const;

export class PdfUnreadable extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PdfUnreadable";
  }
}

export async function extractPdf(bytes: Uint8Array): Promise<PdfExtraction> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let document;
  try {
    document = await pdfjs.getDocument({
      // A copy, because pdf.js transfers ownership of the buffer it is given and the caller still
      // needs these bytes to hash and to hand to nothing else.
      data: new Uint8Array(bytes),
      // No scripting, no eval, no network. A delivered PDF is untrusted input.
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      // Errors belong in the job's own record, not in the process's stdout.
      verbosity: 0,
    }).promise;
  } catch (error) {
    // A file that is not a PDF at all should never get here — the magic bytes were checked at
    // finalize (ADR-031) — so this is a corrupt or encrypted one, and it is a `FAILED`, not a
    // crash: the file stays and the surface says the extraction could not complete.
    throw new PdfUnreadable(error instanceof Error ? error.message.slice(0, 200) : "unreadable");
  }

  const pageCount = document.numPages;
  if (pageCount > PDF_LIMITS.maxPages) {
    throw new PdfUnreadable(`this PDF declares ${pageCount} pages, beyond what is processed here`);
  }

  const pages: string[] = [];
  let characters = 0;
  try {
    for (let number = 1; number <= pageCount; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = joinTextItems(content.items);
      characters += text.length;
      if (characters > PDF_LIMITS.maxCharacters) {
        throw new PdfUnreadable("this PDF carries more text than is processed here");
      }
      pages.push(text);
      // pdf.js caches per page; a 2 000-page study would otherwise hold all of it at once.
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }

  const assessment = assessNativeText(pages);
  return {
    kind: "PAGE",
    pageCount,
    // A page with no text is still a page: dropping it would shift every page number after it.
    units: pages.map((text, index) => ({
      ordinal: index + 1,
      kind: "PAGE" as const,
      sectionPath: null,
      text,
    })),
    assessment,
  };
}

/**
 * Glyph runs back into readable lines.
 *
 * pdf.js reports positioned items, and `hasEOL` is its own statement about where a line ended —
 * which is better than inferring one from coordinates, because a two-column page has two runs at
 * the same vertical position and guessing produces interleaved nonsense. Items are joined with a
 * space unless one already ends in whitespace; a line break becomes a newline, and a blank line
 * becomes a paragraph boundary the chunker recognises.
 */
function joinTextItems(items: ReadonlyArray<unknown>): string {
  let out = "";
  for (const item of items) {
    const entry = item as { str?: string; hasEOL?: boolean };
    if (typeof entry.str !== "string") continue;
    out += entry.str;
    if (entry.hasEOL) out += "\n";
    else if (entry.str.length > 0 && !/\s$/u.test(entry.str)) out += " ";
  }
  return (
    out
      // A PDF line-wraps mid-sentence; a paragraph is two newlines. Single newlines inside a
      // paragraph become spaces so the chunker's paragraph boundaries are the document's.
      .replace(/[ \t]+\n/gu, "\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim()
  );
}
