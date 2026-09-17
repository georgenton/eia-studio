import {
  assertProcessingTransition,
  assessNativeText,
  CHUNK_LOCATOR_KINDS,
  DOCUMENT_PROCESSING_TRANSITIONS,
  InvalidInput,
  MAX_SECTION_PATH,
  OCR_THRESHOLDS,
  sectionPath,
} from "../src/index";
import { describe, expect, it } from "vitest";

/**
 * The three things extraction must not invent (ADR-033): a page number for a file that has none,
 * text for a page that has none, and a state transition nobody defined.
 */
const prose = (times: number) =>
  "El estudio describe la afectación predial a lo largo del corredor vial. ".repeat(times);

describe("whether a PDF carried text or is a scan", () => {
  it("reads a born-digital study", () => {
    const assessment = assessNativeText([prose(5), prose(6), prose(4)]);
    expect(assessment.hasNativeText).toBe(true);
    expect(assessment.reason).toBeNull();
    expect(assessment.pagesWithText).toBe(3);
  });

  /*
   * The failure this prevents: a scanned study extracted to forty characters of header noise,
   * chunked, indexed, and then *searchable* — a document that appears to answer questions and
   * cannot. `REQUIRES_OCR` is the honest terminal state.
   */
  it("refuses a scan, rather than indexing the noise a scan yields", () => {
    const assessment = assessNativeText(["", "", "   ", ""]);
    expect(assessment.hasNativeText).toBe(false);
    expect(assessment.reason).toBe("SCANNED_OR_IMAGE_ONLY");
    expect(assessment.totalCharacters).toBe(0);
  });

  it("refuses a header stamp on every page", () => {
    // 20 pages, each carrying a scanner's date stamp and nothing else. Twenty stamps clear the
    // *total* threshold — which is exactly why the per-page rule exists: no page carries enough
    // to be a page of text, so the ratio is zero and the document is a scan.
    const assessment = assessNativeText(Array.from({ length: 20 }, () => "2026-03-04 09:12"));
    expect(assessment.totalCharacters).toBeGreaterThan(OCR_THRESHOLDS.minTotalCharacters);
    expect(assessment.pagesWithText).toBe(0);
    expect(assessment.hasNativeText).toBe(false);
    expect(assessment.reason).toBe("SCANNED_OR_IMAGE_ONLY");
  });

  /*
   * The case a total-only test would get wrong, and the reason there are two conditions: a
   * born-digital cover page carries enough characters on its own, and the two hundred scanned
   * pages behind it would be indexed as a readable document on the strength of its title.
   */
  it("refuses a digital cover in front of a scanned study", () => {
    const pages = [prose(10), ...Array.from({ length: 200 }, () => "")];
    const assessment = assessNativeText(pages);
    expect(assessment.totalCharacters).toBeGreaterThan(OCR_THRESHOLDS.minTotalCharacters);
    expect(assessment.hasNativeText).toBe(false);
    expect(assessment.reason).toBe("SCANNED_OR_IMAGE_ONLY");
  });

  it("accepts a study with some blank pages, which every study has", () => {
    const pages = [prose(4), "", prose(4), "", prose(4), ""];
    expect(assessNativeText(pages).hasNativeText).toBe(true);
  });

  it("answers for an empty file without pretending it is readable", () => {
    const assessment = assessNativeText([]);
    expect(assessment.hasNativeText).toBe(false);
    expect(assessment.pageCount).toBe(0);
  });
});

describe("a heading trail, which is what a DOCX citation names", () => {
  it("joins the document's own words and nothing else", () => {
    expect(sectionPath(["6. Plan de Manejo", "6.2 Programa de desechos"])).toBe(
      "6. Plan de Manejo › 6.2 Programa de desechos",
    );
  });

  it("is null when the document gave no headings, rather than an invented one", () => {
    // The honest answer to "where is this paragraph?" in a file with no outline is *nowhere it
    // can say*, and a citation renders the passage number instead.
    expect(sectionPath([])).toBeNull();
    expect(sectionPath(["", "   "])).toBeNull();
  });

  it("keeps the deepest headings when a trail is too long to store", () => {
    const long = sectionPath(
      Array.from({ length: 40 }, (_, i) => `Sección ${i} de un título largo`),
    );
    expect(long).not.toBeNull();
    expect(long!.length).toBeLessThanOrEqual(MAX_SECTION_PATH);
    // Truncated from the front: the nearest heading is the one that locates the paragraph.
    expect(long!.startsWith("… ")).toBe(true);
    expect(long!.endsWith("Sección 39 de un título largo")).toBe(true);
  });
});

describe("what a version may do next", () => {
  it("names both terminal-without-success states as reachable only from PROCESSING", () => {
    expect(DOCUMENT_PROCESSING_TRANSITIONS.PROCESSING).toEqual(["READY", "REQUIRES_OCR", "FAILED"]);
    expect(() => assertProcessingTransition("UPLOADED", "READY")).toThrow(InvalidInput);
    expect(() => assertProcessingTransition("QUEUED", "READY")).toThrow(InvalidInput);
  });

  it("lets a failed or un-OCRed version be asked for again, and a ready one never", () => {
    expect(() => assertProcessingTransition("FAILED", "QUEUED")).not.toThrow();
    expect(() => assertProcessingTransition("REQUIRES_OCR", "QUEUED")).not.toThrow();
    // Chunks are immutable: a second set over the same bytes would make a citation ambiguous, and
    // a corrected file is a new version.
    expect(() => assertProcessingTransition("READY", "QUEUED")).toThrow(InvalidInput);
  });

  it("has exactly two locator kinds, because a file either paginates itself or does not", () => {
    expect(CHUNK_LOCATOR_KINDS).toEqual(["PAGE", "SECTION"]);
  });
});
