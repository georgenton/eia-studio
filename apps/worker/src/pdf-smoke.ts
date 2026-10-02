/**
 * Can *this image* read a PDF?
 *
 * ## Why this exists
 *
 * Staging uploaded a valid, one-page, unencrypted PDF with native text, and the worker answered
 * `the file could not be read`. Every test in this repository passed, because every one of them —
 * including the end-to-end document pipeline, which correctly runs the worker in a process of its
 * own — resolves `pdfjs-dist` from the **workspace's** `node_modules`, where pdf.js's runtime
 * companions are installed by pnpm. The published image resolved them from beside a generated
 * esbuild chunk, where they were not, and `await import(...)` threw
 * `ReferenceError: DOMMatrix is not defined` before a single byte was parsed.
 *
 * The gap was never in the extractor. It was that nothing ever asked the **artefact** the
 * question, and an artefact is what gets deployed. So CI now asks it, against the image it just
 * built, before that image is published (`.github/actions/build-eia-image/action.yml`).
 *
 * ## Why it ships in the image
 *
 * Because the thing under test is the image. A script mounted in at test time would prove that
 * *some* Node process with *some* resolution order can read a PDF; running one the image already
 * carries proves that the image can. It is a few kilobytes, it reads one fixture built in this
 * file, it touches no network, no database, no object store and no document of anybody's — and it
 * does nothing at all unless somebody runs it, which makes it an operator's answer to "is this
 * deployed digest able to extract?" as well as a gate.
 *
 *     docker run --rm --entrypoint node <image> apps/worker/dist/pdf-smoke.js
 *
 * Exit 0 and one JSON line on success; a non-zero exit and the real exception on failure.
 */
import { extractPdf } from "@eia/application";

/**
 * A one-page PDF with native text, built here rather than committed as a binary.
 *
 * Built, because the cross-reference offsets have to match the bytes exactly and a generator
 * cannot drift from its own output; and because a reviewer can read what is in it, which is not
 * true of a base64 blob. Latin-1, because a PDF's offsets are byte offsets.
 *
 * The text is deliberately over `OCR_THRESHOLDS.minTotalCharacters`, so the smoke exercises the
 * whole path the worker takes — parse, per-page text, and the native-text assessment that decides
 * `READY` against `REQUIRES_OCR` — rather than only the part that happens to be broken today.
 */
const LINES = [
  "EIA Studio — prueba de extraccion de texto nativo.",
  "Este documento existe para que la imagen publicada demuestre, antes de",
  "ser desplegada, que puede leer un PDF: que pdf.js carga, que su worker",
  "esta donde pdf.js lo busca, y que getTextContent devuelve caracteres.",
  "No contiene datos de ningun estudio ni de ninguna persona.",
] as const;

function buildFixture(): Uint8Array {
  const content =
    "BT /F1 11 Tf 56 740 Td 15 TL\n" + LINES.map((line) => `(${line}) Tj T*`).join("\n") + "\nET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startxref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** The one word the smoke insists on finding, so "it returned characters" is not enough. */
const EXPECTED = "extraccion";

async function main(): Promise<void> {
  const fixture = buildFixture();
  // Not an assertion about pdf.js: an assertion that the fixture above is still a PDF after an
  // edit to the builder. A smoke that silently started feeding garbage would always fail, and the
  // reader would go looking in the image.
  if (Buffer.from(fixture.slice(0, 5)).toString("latin1") !== "%PDF-") {
    throw new Error("the built fixture is not a PDF");
  }

  const result = await extractPdf(fixture);
  const text = result.units.map((unit) => unit.text).join("\n");

  if (result.pageCount < 1) throw new Error(`expected at least one page, got ${result.pageCount}`);
  if (text.length < 1) throw new Error("the PDF was parsed and no text came back");
  if (!text.includes(EXPECTED)) {
    throw new Error(`the extracted text does not contain "${EXPECTED}"`);
  }
  if (!result.assessment.hasNativeText) {
    throw new Error(
      `the fixture was not assessed as carrying native text: ${result.assessment.reason}, ` +
        `${result.assessment.totalCharacters} characters`,
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      pages: result.pageCount,
      characters: result.assessment.totalCharacters,
      pagesWithText: result.assessment.pagesWithText,
      node: process.version,
    })}\n`,
  );
}

try {
  await main();
} catch (error) {
  // The real exception, deliberately. This process reads one fixture it built itself, so there is
  // no document of anybody's here to leak — which is exactly why it is the right place to print
  // what `settleFailure` is right to withhold from a consultant's screen.
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split("\n").slice(0, 8) : undefined,
    })}\n`,
  );
  process.exit(1);
}
