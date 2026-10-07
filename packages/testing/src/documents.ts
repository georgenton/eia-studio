import { zipSync, strToU8 } from "fflate";

/**
 * Real files, built byte by byte, for the extraction suite (ADR-033).
 *
 * A fixture read off disk would work, but a **generated** one lets a test say what it is testing:
 * *a PDF with three pages whose second is blank*, *a DOCX whose headings are two levels deep*, *a
 * PDF with no text at all*. The interesting cases are the ones nobody has a sample of.
 *
 * The PDF is written with a correct cross-reference table, because pdf.js reconstructs a broken
 * one and a test that relied on the reconstruction would be testing the recovery path.
 */

/** A PDF whose pages carry exactly the text given, one page per entry. */
export function buildPdf(pages: ReadonlyArray<string>): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);

  // 1 catalogue, 2 pages tree, 3 font, then a page object and a content stream per page.
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  for (const [index, text] of pages.entries()) {
    const contentId = pageIds[index]! + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const stream = contentStream(text);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return strToU8(body + xref + trailer, true);
}

/**
 * One page's content stream.
 *
 * Text is drawn line by line, because a PDF has no paragraph concept — a renderer positions runs,
 * and `Td` between lines is what makes pdf.js report an end-of-line. An empty page draws nothing,
 * which is what a scanned page looks like to a text extractor.
 */
function contentStream(text: string): string {
  if (text.trim().length === 0) return "";
  const lines = text.match(/.{1,90}(\s|$)/gu) ?? [text];
  let out = "BT\n/F1 11 Tf\n14 TL\n72 720 Td\n";
  for (const line of lines) out += `(${escapePdf(line.trim())}) Tj\nT*\n`;
  return `${out}ET`;
}

function escapePdf(text: string): string {
  return (
    text
      .replaceAll("\\", "\\\\")
      .replaceAll("(", "\\(")
      .replaceAll(")", "\\)")
      // The standard Helvetica encoding is single-byte; accents would need a font this fixture
      // does not embed, so they are folded rather than written as bytes pdf.js would read wrongly.
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
  );
}

export interface DocxParagraph {
  readonly text: string;
  /** 1, 2, 3 … for a heading; omitted for body text. */
  readonly headingLevel?: number;
}

/** A DOCX whose body is exactly these paragraphs, with real Word heading styles. */
export function buildDocx(paragraphs: ReadonlyArray<DocxParagraph>): Uint8Array {
  const body = paragraphs
    .map((paragraph) => {
      const style =
        paragraph.headingLevel === undefined
          ? ""
          : `<w:pPr><w:pStyle w:val="Heading${paragraph.headingLevel}"/></w:pPr>`;
      return `<w:p>${style}<w:r><w:t xml:space="preserve">${escapeXml(paragraph.text)}</w:t></w:r></w:p>`;
    })
    .join("");

  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}</w:body></w:document>`;

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    [1, 2, 3]
      .map(
        (level) =>
          `<w:style w:type="paragraph" w:styleId="Heading${level}">` +
          `<w:name w:val="heading ${level}"/><w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
          `</w:style>`,
      )
      .join("") +
    `</w:styles>`;

  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="xml" ContentType="application/xml"/></Types>`,
    ),
    "word/document.xml": strToU8(document),
    "word/styles.xml": strToU8(styles),
  });
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * An archive that lies about how much it expands to.
 *
 * Built from highly compressible content so the declared uncompressed size is far beyond the
 * compressed one — the shape `ARCHIVE_LIMITS` exists to refuse, without writing a gigabyte to
 * disk to prove it.
 */
export function buildZipBomb(): Uint8Array {
  return zipSync(
    {
      "word/document.xml": strToU8("<w:document/>"),
      "payload.bin": new Uint8Array(80 * 1024 * 1024),
    },
    { level: 9 },
  );
}

/* ---------------------------------------------------------------------------------------------
 * Synthetic templates (ADR-036)
 *
 * These are **not** any consultancy's templates. They are the smallest Word packages that carry
 * the shapes the renderer has to survive: a placeholder split across runs the way Word actually
 * writes one, a macro project, a container that is not a Word document at all.
 * ------------------------------------------------------------------------------------------ */

export interface TemplateParagraph {
  /** One entry per `<w:r>`. Splitting a placeholder across entries is the point. */
  readonly runs: ReadonlyArray<string>;
  readonly headingLevel?: number;
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;

const RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

function documentXml(paragraphs: ReadonlyArray<TemplateParagraph>): string {
  const body = paragraphs
    .map((paragraph) => {
      const style =
        paragraph.headingLevel === undefined
          ? ""
          : `<w:pPr><w:pStyle w:val="Heading${paragraph.headingLevel}"/></w:pPr>`;
      const runs = paragraph.runs
        .map((run) => `<w:r><w:t xml:space="preserve">${escapeXml(run)}</w:t></w:r>`)
        .join("");
      return `<w:p>${style}${runs}</w:p>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}</w:body></w:document>`
  );
}

/** A Word package whose body is exactly these paragraphs, run by run. */
/**
 * A fixed modification time for every archive these helpers build.
 *
 * `zipSync` stamps each entry with the current time by default, at the ZIP format's two-second
 * granularity — so the *same* template built twice produces *different* bytes, depending only on
 * which side of a two-second boundary the two calls fell. That made "the same bytes twice are
 * answered rather than duplicated" (ADR-031, ADR-036) a test that passed when the suite was fast
 * and failed when it was not, which is the worst kind: it looks like a product regression.
 *
 * Fixed here rather than worked around in the assertion, because *same input, same bytes* is what
 * a fixture owes a test about content hashing.
 */
const FIXTURE_MTIME = new Date("2026-01-01T00:00:00Z");

export function buildDocxTemplate(paragraphs: ReadonlyArray<TemplateParagraph>): Uint8Array {
  return zipSync({
    "[Content_Types].xml": [strToU8(CONTENT_TYPES), { mtime: FIXTURE_MTIME }],
    "_rels/.rels": [strToU8(RELS), { mtime: FIXTURE_MTIME }],
    "word/document.xml": [strToU8(documentXml(paragraphs)), { mtime: FIXTURE_MTIME }],
  });
}

/**
 * The same package carrying a macro project.
 *
 * A `.docm` renamed `.docx` presents the same `PK\x03\x04` signature and the same declared MIME
 * type, so the only place to catch it is inside the archive.
 */
export function buildMacroEnabledTemplate(
  paragraphs: ReadonlyArray<TemplateParagraph>,
): Uint8Array {
  return zipSync({
    "[Content_Types].xml": [strToU8(CONTENT_TYPES), { mtime: FIXTURE_MTIME }],
    "_rels/.rels": [strToU8(RELS), { mtime: FIXTURE_MTIME }],
    "word/document.xml": [strToU8(documentXml(paragraphs)), { mtime: FIXTURE_MTIME }],
    // Not a real VBA project — the name is what makes a package macro-enabled.
    "word/vbaProject.bin": [
      strToU8("this stands in for a macro project"),
      { mtime: FIXTURE_MTIME },
    ],
  });
}

/** A ZIP that is not a Word document: the case the magic bytes cannot tell apart from one. */
export function buildNotAWordPackage(): Uint8Array {
  return zipSync({
    "readme.txt": [
      strToU8("A container with no Word main part inside it."),
      { mtime: FIXTURE_MTIME },
    ],
    "data/rows.csv": [strToU8("a,b,c\n1,2,3\n"), { mtime: FIXTURE_MTIME }],
  });
}

/* ---------------------------------------------------------------------------------------------
 * A photograph that carries what a photograph carries
 * ------------------------------------------------------------------------------------------ */

/**
 * A synthetic JPEG with an EXIF APP1 segment containing GPS coordinates.
 *
 * Built by hand rather than committed as a binary, so a reader can see exactly what is in it —
 * and so the test that says "the derivative has no GPS" is testing against something that
 * demonstrably had some. The coordinates are a point in the Pacific off Ecuador; no real place
 * anybody works, and no real photograph.
 *
 * The image itself is produced by sharp, because an encoder written here would be the thing
 * under test rather than a fixture.
 */
export async function buildJpegWithGps(options?: {
  width?: number;
  height?: number;
}): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  const width = options?.width ?? 240;
  const height = options?.height ?? 160;
  const base = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 32, g: 96, b: 128 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  return new Uint8Array(insertExifApp1(base, buildGpsExif()));
}

/** A minimal TIFF-in-EXIF payload: one IFD0 entry pointing at a GPS IFD with three tags. */
function buildGpsExif(): Buffer {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(8);
  header.write("MM", 0, "ascii"); // big-endian
  header.writeUInt16BE(42, 2);
  header.writeUInt32BE(8, 4); // IFD0 at offset 8
  parts.push(header);

  // IFD0: one entry, GPSInfoIFDPointer (0x8825) -> offset 26
  const ifd0 = Buffer.alloc(2 + 12 + 4);
  ifd0.writeUInt16BE(1, 0);
  ifd0.writeUInt16BE(0x8825, 2);
  ifd0.writeUInt16BE(4, 4); // LONG
  ifd0.writeUInt32BE(1, 6);
  ifd0.writeUInt32BE(26, 10);
  ifd0.writeUInt32BE(0, 14); // no next IFD
  parts.push(ifd0);

  // GPS IFD: latitude ref, longitude ref, and an altitude, all inline.
  const gps = Buffer.alloc(2 + 12 * 2 + 4);
  gps.writeUInt16BE(2, 0);
  // GPSLatitudeRef = "S"
  gps.writeUInt16BE(0x0001, 2);
  gps.writeUInt16BE(2, 4); // ASCII
  gps.writeUInt32BE(2, 6);
  gps.write("S\0", 10, "ascii");
  // GPSLongitudeRef = "W"
  gps.writeUInt16BE(0x0003, 14);
  gps.writeUInt16BE(2, 16);
  gps.writeUInt32BE(2, 18);
  gps.write("W\0", 22, "ascii");
  gps.writeUInt32BE(0, 26);
  parts.push(gps);

  return Buffer.concat([Buffer.from("Exif\0\0", "ascii"), ...parts]);
}

/** Splice an APP1 segment in immediately after SOI, which is where a camera writes it. */
function insertExifApp1(jpeg: Buffer, exif: Buffer): Buffer {
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1, 0);
  marker.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), marker, exif, jpeg.subarray(2)]);
}

/**
 * A minimal, macro-free PPTX: a ZIP carrying the two parts that make it a presentation.
 *
 * Enough for the upload path, which checks the extension, the declared type and the `PK\x03\x04`
 * signature — and deliberately not a real deck, because nothing in this product opens one. No
 * `ppt/vbaProject.bin`, so it is also the negative control for the macro refusal.
 */
export function buildPptx(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        "</Types>",
    ),
    "ppt/presentation.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
    ),
  });
}
