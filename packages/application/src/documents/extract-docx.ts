import {
  assertArchiveWithinLimits,
  ARCHIVE_LIMITS,
  sectionPath,
  UnsupportedUpload,
  type ExtractionResult,
} from "@eia/domain";

/**
 * Reading a DOCX, which is a ZIP, without letting the ZIP read us (ADR-033).
 *
 * ## Why the archive is opened by hand rather than by a converter
 *
 * A library that turns a DOCX into HTML or Markdown would be quicker to write and would throw away
 * the only thing this product needs: **where in the document a paragraph sits**. A citation has to
 * be checkable, and in a file with no page model the checkable thing is the heading trail — *6.
 * Plan de Manejo › 6.2 Programa de manejo de desechos*. So the paragraphs and their styles are read
 * directly from `word/document.xml`.
 *
 * The second reason is the limits. `ARCHIVE_LIMITS` in the domain bounds entry count, per-entry
 * size, total uncompressed size and compression ratio, and they only mean something if this code
 * decides what to decompress. A converter handed the file decides for itself, and a 40 KB archive
 * that expands to a gigabyte is a process that stops answering.
 *
 * ## What is never executed
 *
 * Nothing. Entries are read, never run: no macro (`vbaProject.bin` is not read at all), no external
 * reference resolved, no relationship followed off the file. Only two entries are decompressed —
 * the document body and the style map — and everything else in the archive is checked against the
 * limits and ignored.
 */
export class DocxUnreadable extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "DocxUnreadable";
  }
}

const BODY_ENTRY = "word/document.xml";
const STYLES_ENTRY = "word/styles.xml";

export async function extractDocx(bytes: Uint8Array): Promise<ExtractionResult> {
  const { unzipSync } = await import("fflate");

  /*
   * The limits are checked **while the archive is being walked, not after**, and against every
   * entry's *declared* size rather than the two this code keeps. That is where a zip bomb lies: a
   * 40 KB archive whose central directory says one entry expands to a gigabyte. `fflate` calls the
   * filter for every entry with its declared size, and decompresses only what the filter accepts —
   * so throwing from inside it stops before anything is expanded.
   */
  let entryCount = 0;
  let uncompressedBytes = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        entryCount += 1;
        uncompressedBytes += file.originalSize ?? 0;
        assertArchiveWithinLimits({
          entries: entryCount,
          uncompressedBytes,
          compressedBytes: bytes.byteLength,
        });
        // Only two entries are ever read: the body and the style map. A macro project, an embedded
        // object and an external relationship are all simply not decompressed.
        return file.name === BODY_ENTRY || file.name === STYLES_ENTRY;
      },
    });
  } catch (error) {
    if (error instanceof UnsupportedUpload) throw error;
    throw new DocxUnreadable(error instanceof Error ? error.message.slice(0, 200) : "unreadable");
  }

  const body = entries[BODY_ENTRY];
  if (!body) throw new DocxUnreadable("this file has no word/document.xml; it is not a DOCX body");

  const xml = new TextDecoder("utf-8").decode(body);
  const headingStyles = entries[STYLES_ENTRY]
    ? headingStyleIds(new TextDecoder("utf-8").decode(entries[STYLES_ENTRY]))
    : new Set<string>();

  return readParagraphs(xml, headingStyles);
}

/**
 * Which style ids this document calls a heading.
 *
 * A DOCX names its own styles, and a Spanish template names them `Ttulo1`, `Titulo1`, `Heading1`
 * or whatever the author typed. What is reliable is `w:styleId` combined with the built-in outline
 * level, so the style map is read and anything whose id looks like a heading — or that declares an
 * outline level — counts. A file with no `styles.xml` falls back to the id pattern alone.
 */
function headingStyleIds(stylesXml: string): Set<string> {
  const ids = new Set<string>();
  const styleBlocks = stylesXml.split(/<w:style[ >]/u).slice(1);
  for (const block of styleBlocks) {
    const id = /w:styleId="([^"]+)"/u.exec(block)?.[1];
    if (!id) continue;
    if (/<w:outlineLvl\b/u.test(block) || isHeadingId(id)) ids.add(id);
  }
  return ids;
}

function isHeadingId(id: string): boolean {
  // `Heading1`, `Ttulo1`, `Titulo1`, `berschrift1` — the built-in id in whichever language Word
  // was installed in. The trailing digit is the level and is what the trail is built from.
  return /^(heading|t[ií]tulo|ttulo|berschrift|titre|titolo)\s*\d$/iu.test(id.replace(/\s+/gu, ""));
}

function headingLevel(styleId: string): number | null {
  const digit = /(\d)\s*$/u.exec(styleId)?.[1];
  return digit ? Number(digit) : null;
}

/**
 * Paragraphs, in order, each carrying the headings above it.
 *
 * Deliberately a scan rather than a DOM parse: the body of a large study is tens of megabytes of
 * XML, and building a tree for it costs several times that in memory for a result this code reads
 * once, forwards. `w:p` is the paragraph, `w:pStyle` names its style, and `w:t` holds the runs of
 * text — everything else in the file (tracked changes, comments, drawing anchors) is skipped by
 * not being one of those.
 */
function readParagraphs(xml: string, headingStyles: ReadonlySet<string>): ExtractionResult {
  const bodyStart = xml.indexOf("<w:body");
  const body = bodyStart === -1 ? xml : xml.slice(bodyStart);

  const units: Array<{
    ordinal: number;
    kind: "SECTION";
    sectionPath: string | null;
    text: string;
  }> = [];
  const trail: string[] = [];
  let ordinal = 0;

  for (const block of body.split(/<w:p[ >]/u).slice(1)) {
    const paragraph = block.slice(
      0,
      block.indexOf("</w:p>") === -1 ? undefined : block.indexOf("</w:p>"),
    );
    const text = paragraphText(paragraph);
    if (text.length === 0) continue;

    const styleId = /<w:pStyle[^>]*w:val="([^"]+)"/u.exec(paragraph)?.[1] ?? "";
    const isHeading = styleId.length > 0 && headingStyles.has(styleId);

    if (isHeading) {
      const level = headingLevel(styleId) ?? trail.length + 1;
      // A level-2 heading replaces everything from level 2 down; a deeper one is appended. The
      // trail is therefore the document's own outline rather than a flat list of the last few
      // headings seen.
      trail.length = Math.min(trail.length, Math.max(0, level - 1));
      trail[Math.max(0, level - 1)] = text;
      trail.length = Math.max(0, level);
    }

    ordinal += 1;
    units.push({
      ordinal,
      kind: "SECTION",
      // A heading is itself a unit, under the trail that now includes it: a citation of a heading
      // should read as that heading rather than as the one above it.
      sectionPath: sectionPath(trail),
      text,
    });
  }

  return {
    units,
    kind: "SECTION",
    // Zero, and honestly so: a DOCX has no page count this product could know, and reporting one
    // would be the invention this whole module exists to avoid.
    pageCount: 0,
  };
}

function paragraphText(paragraph: string): string {
  let out = "";
  for (const match of paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)) {
    out += decodeXml(match[1] ?? "");
  }
  // `w:tab` and `w:br` are the separators a table cell and a line break leave behind; without them
  // two columns of a row run together into one word.
  if (/<w:tab\b/u.test(paragraph) || /<w:br\b/u.test(paragraph)) out = out.replace(/\s+/gu, " ");
  return out.replace(/\s+/gu, " ").trim();
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** Re-exported so the worker's limits and the domain's cannot drift. */
export { ARCHIVE_LIMITS };
