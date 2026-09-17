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
