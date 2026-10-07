import { buildJpegWithGps } from "@eia/testing/documents";
import { describe, expect, it } from "vitest";

import { buildPublishableImage, describeImageMetadata } from "../src/portal/editorial-image";

/**
 * A published photograph carries no EXIF, because it was never written — not because something
 * removed it.
 *
 * The fixture is a synthetic JPEG this suite builds with a real EXIF APP1 segment containing GPS
 * reference tags. Starting from an image that demonstrably *has* GPS is the whole point: a test
 * that says "no GPS found" over a file that never had any proves nothing.
 *
 * Two independent checks on the way out. sharp's own metadata reader, and a raw scan of the bytes
 * for the `Exif\0\0` marker — because the first one is the same library that produced the output,
 * and a library agreeing with itself is weaker evidence than a reader that knows nothing about it.
 */
const EXIF_MARKER = Buffer.from("Exif\u0000\u0000", "ascii");

describe("the fixture, before anything is done to it", () => {
  it("really does carry EXIF with GPS", async () => {
    const original = await buildJpegWithGps();
    expect(Buffer.from(original).includes(EXIF_MARKER)).toBe(true);
    const metadata = await describeImageMetadata(original);
    expect(metadata.hasExif).toBe(true);
  });
});

describe("the derivative", () => {
  it("has no EXIF, by either reader", async () => {
    const derivative = await buildPublishableImage(await buildJpegWithGps());
    const metadata = await describeImageMetadata(derivative.bytes);
    expect(metadata.hasExif).toBe(false);
    expect(metadata.hasGps).toBe(false);
    expect(metadata.hasXmp).toBe(false);
    // The second reader: the marker a camera writes is simply not in the file.
    expect(Buffer.from(derivative.bytes).includes(EXIF_MARKER)).toBe(false);
  });

  it("is a different file, with its own identity", async () => {
    const original = await buildJpegWithGps();
    const derivative = await buildPublishableImage(original);
    expect(Buffer.from(derivative.bytes).equals(Buffer.from(original))).toBe(false);
    expect(derivative.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("is still a valid image of the right shape", async () => {
    const derivative = await buildPublishableImage(
      await buildJpegWithGps({ width: 240, height: 160 }),
    );
    expect(derivative.format).toBe("jpeg");
    expect(derivative.mimeType).toBe("image/jpeg");
    expect(derivative.width).toBe(240);
    expect(derivative.height).toBe(160);
  });

  it("bounds a large photograph rather than publishing it whole", async () => {
    const derivative = await buildPublishableImage(
      await buildJpegWithGps({ width: 4000, height: 3000 }),
    );
    expect(Math.max(derivative.width, derivative.height)).toBeLessThanOrEqual(2400);
    // The aspect ratio is the photographer's, and resizing does not get to change it.
    expect(derivative.width / derivative.height).toBeCloseTo(4000 / 3000, 2);
  });

  it("keeps a PNG a PNG, because that choice was somebody's", async () => {
    const { default: sharp } = await import("sharp");
    const png = new Uint8Array(
      await sharp({
        create: { width: 60, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .png()
        .toBuffer(),
    );
    const derivative = await buildPublishableImage(png);
    expect(derivative.format).toBe("png");
    expect(derivative.mimeType).toBe("image/png");
  });

  it("refuses something that is not an image, with bounded words", async () => {
    const notAnImage = new Uint8Array(Buffer.from("%PDF-1.4\nnot a picture", "latin1"));
    await expect(buildPublishableImage(notAnImage)).rejects.toThrow(
      /could not be read as an image/,
    );
  });
});
