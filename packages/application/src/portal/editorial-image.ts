import { createHash } from "node:crypto";

import { InvalidInput } from "@eia/domain";
import type { Metadata, Sharp, default as SharpFactoryType } from "sharp";

/**
 * A photograph a consultancy may publish, made from one it uploaded.
 *
 * ## Why a derivative at all
 *
 * A JPEG off a phone carries EXIF, and EXIF carries where and when and with what the picture was
 * taken. Publishing the uploaded bytes publishes all of it. The rule for field evidence is the
 * opposite — ADR-032 keeps a technician's photograph exactly as the camera wrote it, because
 * altering evidence is worse than carrying metadata — and the two rules do not conflict, because
 * these are different files for different purposes. **Nothing here touches `field-media`.**
 *
 * ## Why re-encode rather than strip
 *
 * Deleting "the tags we know about" is a list that is wrong the moment a camera writes a new one,
 * and it leaves the original's bytes otherwise intact — including any maker note nobody parsed.
 * Decoding to pixels and encoding again produces **new bytes**, and metadata is absent because it
 * was never written, not because something removed it. That is a property of the operation rather
 * than of a denylist.
 *
 * ## Why sharp
 *
 * It is already in this workspace and already inside the published image, with its native binary:
 * Next uses it for image optimisation, so the runtime proved it loads long before this file
 * existed. Adding it as a declared dependency at the version already resolved costs no supply
 * chain and no image size — it only stops it being a phantom dependency. The alternative, a JPEG
 * encoder of our own, is not a thing to write.
 *
 * sharp copies no metadata unless asked (`withMetadata()`), which this never calls. `rotate()`
 * with no argument is the one piece of EXIF that must survive, and it survives as **pixels**: the
 * orientation tag is applied and then gone, so a portrait photograph is still the right way up in
 * a viewer that never reads EXIF.
 *
 * ## Why the import is dynamic
 *
 * sharp is a native module, so a bundler cannot inline it — and the worker bundles
 * `@eia/application` whole. A static import at module scope put sharp in the worker's graph and
 * the built worker then failed to load at all, over a library it never calls. The same shape as
 * the pdf.js packaging defect, caught here by building the worker rather than by deploying it.
 *
 * Loaded on first use instead, with `sharp` external to that bundle: the web process resolves it
 * when somebody publishes a photograph, and the worker never reaches the import.
 */

/** Loaded on first call, cached after. The web process is the only caller. */
let sharpModule: typeof SharpFactoryType | null = null;
async function loadSharp(): Promise<typeof SharpFactoryType> {
  sharpModule ??= (await import("sharp")).default;
  return sharpModule;
}

/** Bounds a published photograph, so one upload cannot become a 100-megapixel page. */
export const EDITORIAL_IMAGE_LIMITS = {
  /** Longest side. A page is read on a laptop and a phone, not printed. */
  maxDimension: 2400,
  /** Refused above this *before* decoding: a decompression bomb is bounded by input, not output. */
  maxInputPixels: 60_000_000,
  jpegQuality: 82,
} as const;

export interface EditorialImageDerivative {
  readonly bytes: Uint8Array;
  readonly format: "jpeg" | "png";
  readonly mimeType: "image/jpeg" | "image/png";
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

/**
 * Decode, apply orientation, bound the size, and encode again.
 *
 * A PNG stays a PNG and everything else becomes a JPEG: PNG is the format people use when they
 * need the alpha channel or a screenshot's sharp edges, and silently turning it into a JPEG would
 * be a visible change to somebody's figure. Everything else gains nothing from staying what it
 * was.
 */
export async function buildPublishableImage(input: Uint8Array): Promise<EditorialImageDerivative> {
  const sharp = await loadSharp();
  let pipeline: Sharp;
  let metadata: Metadata;
  try {
    pipeline = sharp(Buffer.from(input), {
      limitInputPixels: EDITORIAL_IMAGE_LIMITS.maxInputPixels,
      // No sequential read of an animated image: a published photograph is one frame.
      animated: false,
    });
    metadata = await pipeline.metadata();
  } catch {
    // Bounded: the file's own bytes never reach a message a person reads.
    throw new InvalidInput("this file could not be read as an image");
  }

  if (metadata.format !== "jpeg" && metadata.format !== "png") {
    throw new InvalidInput("a published photograph is a JPEG or a PNG");
  }
  const format = metadata.format === "png" ? "png" : "jpeg";

  const rendered = await pipeline
    // The orientation tag, applied to the pixels and then discarded with the rest of the EXIF.
    .rotate()
    .resize({
      width: EDITORIAL_IMAGE_LIMITS.maxDimension,
      height: EDITORIAL_IMAGE_LIMITS.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    // No `.withMetadata()`. That call is what would copy EXIF across, and its absence is the
    // whole mechanism: the encoder writes the tags it needs and nothing it was given.
    .toFormat(format, format === "jpeg" ? { quality: EDITORIAL_IMAGE_LIMITS.jpegQuality } : {})
    .toBuffer({ resolveWithObject: true });

  return {
    bytes: new Uint8Array(rendered.data),
    format,
    mimeType: format === "png" ? "image/png" : "image/jpeg",
    width: rendered.info.width,
    height: rendered.info.height,
    // New bytes, so a new identity. The original keeps its own, and the two are linked by a row.
    sha256: createHash("sha256").update(rendered.data).digest("hex"),
  };
}

/**
 * What a reader of a derivative may check: that nothing private came across.
 *
 * Used by the tests and by the publishing path's own assertion, so "there is no EXIF in this"
 * is verified against the bytes rather than assumed from how they were made.
 */
export async function describeImageMetadata(
  bytes: Uint8Array,
): Promise<{ hasExif: boolean; hasGps: boolean; hasXmp: boolean; hasIccProfile: boolean }> {
  const sharp = await loadSharp();
  const metadata = await sharp(Buffer.from(bytes)).metadata();
  return {
    hasExif: metadata.exif !== undefined,
    // sharp surfaces parsed GPS only through `exif`; its absence is therefore the test, and the
    // raw-buffer scan in the test suite is the second, independent one.
    hasGps: metadata.exif !== undefined,
    hasXmp: metadata.xmp !== undefined,
    hasIccProfile: metadata.icc !== undefined,
  };
}
