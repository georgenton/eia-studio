/**
 * Can *this image* produce a publishable photograph?
 *
 * ## Why this exists
 *
 * The same question `pdf-smoke.ts` exists for, about a different native module. A published
 * photograph is a **derivative**: the uploaded bytes are decoded and encoded again so that EXIF —
 * where and when and with what the picture was taken — is absent because it was never written
 * (`packages/application/src/portal/editorial-image.ts`). That re-encode is sharp, and sharp is a
 * native binary that is resolved at runtime, from wherever the artefact happens to put it.
 *
 * Every test of the derivative in this repository resolves sharp from the **workspace's**
 * `node_modules`. That is exactly the shape of the pdf.js defect staging found: the tests were
 * all green and the published image could not load the library. So the artefact is asked, in the
 * artefact, before its digest goes anywhere.
 *
 * A failure here is not cosmetic. If sharp cannot load, publishing a photograph fails — and the
 * failure mode that would matter is the one where somebody "fixes" it by serving the original
 * instead, which is the uploaded file with its GPS intact.
 *
 *     docker run --rm --entrypoint node <image> apps/worker/dist/image-smoke.js
 *
 * Exit 0 and one JSON line on success; a non-zero exit and the real exception on failure.
 *
 * ## Why the worker carries it
 *
 * Because `apps/worker/dist` is already in the image and already the place these entry points
 * live. The worker itself never calls sharp — the derivative is made in the web request path, and
 * `apps/worker/tsup.config.ts` keeps sharp external precisely so the worker does not load it —
 * but both processes resolve from the same `/app/node_modules`, so asking from here answers for
 * the image rather than for one process.
 *
 * sharp is therefore a **devDependency** of `@eia/worker`: this file needs its types to compile
 * and its binary to run, and the worker's own code never touches it.
 */
import { buildPublishableImage, describeImageMetadata } from "@eia/application";

/** Bytes an EXIF-bearing JPEG begins its APP1 segment with; the independent check. */
const EXIF_MARKER = Buffer.from("Exif\u0000\u0000", "latin1");

/**
 * A small JPEG that genuinely carries EXIF, written by sharp itself.
 *
 * Built rather than committed, for the reason the PDF fixture is: a reviewer can read what is in
 * it, and it cannot drift from a binary nobody opens. It is a 64×48 solid colour and contains no
 * photograph of anywhere and nobody's coordinates — the GPS tag below is a fixed, invented value
 * whose only purpose is to be *present*, so that its absence afterwards means something.
 */
async function buildFixture(): Promise<{ bytes: Uint8Array; sharpVersion: string }> {
  const sharp = (await import("sharp")).default;
  const bytes = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 24, g: 80, b: 107 } },
  })
    .withExif({
      IFD0: { Make: "EIA Studio", Software: "image-smoke" },
      IFD3: { GPSLatitudeRef: "S", GPSLongitudeRef: "W" },
    })
    .jpeg()
    .toBuffer();
  return { bytes: new Uint8Array(bytes), sharpVersion: sharp.versions.vips };
}

async function main(): Promise<void> {
  const { bytes: original, sharpVersion } = await buildFixture();

  /*
   * Not an assertion about the derivative: an assertion that the fixture is worth testing. A
   * smoke whose input quietly stopped carrying EXIF would pass for ever while proving nothing,
   * which is the failure this whole file exists to avoid in the first place.
   */
  if (!Buffer.from(original).includes(EXIF_MARKER)) {
    throw new Error("the built fixture carries no EXIF, so it cannot demonstrate its removal");
  }
  const before = await describeImageMetadata(original);
  if (!before.hasExif) throw new Error("sharp does not see EXIF in the built fixture");

  const derivative = await buildPublishableImage(original);

  if (derivative.format !== "jpeg") throw new Error(`expected a JPEG, got ${derivative.format}`);
  if (derivative.width !== 64 || derivative.height !== 48) {
    throw new Error(`expected 64×48, got ${derivative.width}×${derivative.height}`);
  }
  if (derivative.sha256.length !== 64) throw new Error("the derivative has no content hash");

  // Two independent checks, because one of them is sharp telling us about sharp's own output.
  const after = await describeImageMetadata(derivative.bytes);
  if (after.hasExif || after.hasGps || after.hasXmp) {
    throw new Error("the derivative still carries metadata");
  }
  if (Buffer.from(derivative.bytes).includes(EXIF_MARKER)) {
    throw new Error("the derivative's bytes still contain an EXIF segment");
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      format: derivative.format,
      width: derivative.width,
      height: derivative.height,
      originalBytes: original.length,
      derivativeBytes: derivative.bytes.length,
      exifBefore: true,
      exifAfter: false,
      vips: sharpVersion,
      node: process.version,
    })}\n`,
  );
}

try {
  await main();
} catch (error) {
  // The real exception, for the reason `pdf-smoke.ts` gives: this process made its own fixture,
  // so there is nothing of anybody's here to withhold.
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
