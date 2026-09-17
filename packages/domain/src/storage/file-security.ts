import { InvalidInput } from "../core/errors";

/**
 * What a file claims to be, and what it actually is.
 *
 * A `.exe` renamed `.pdf` must not enter the extraction pipeline as a PDF, and the only way to
 * know is to look at the bytes. Three claims are checked against each other — the extension, the
 * declared MIME type, and the **signature** at the head of the file — and all three must agree
 * before anything is stored as a document.
 *
 * ## Why an allowlist and not a scanner
 *
 * This is not antivirus and does not pretend to be. It is a narrow gate: two formats go live
 * (`.pdf`, `.docx`), each has one MIME type and one signature, and everything else is refused by
 * not being on the list. A denylist would have to enumerate what is dangerous, which is the set
 * nobody can finish.
 *
 * ## Why DOCX is a container and never executable content
 *
 * A `.docx` is a ZIP. It may carry macros, external references and, if nothing bounds it, a
 * compression ratio that turns 40 KB into a gigabyte of memory. Nothing here executes any part of
 * it: extraction reads entries, never runs them, and the limits below bound what it may read.
 */
export const UPLOAD_FORMATS = ["pdf", "docx", "jpeg", "png"] as const;
export type UploadFormat = (typeof UPLOAD_FORMATS)[number];

export interface FormatDescriptor {
  readonly format: UploadFormat;
  readonly extensions: ReadonlyArray<string>;
  readonly mimeTypes: ReadonlyArray<string>;
  /** The first bytes every file of this format begins with. */
  readonly signature: ReadonlyArray<number>;
  /** Refused above this, by the intent as well as at finalize. */
  readonly maxBytes: number;
}

const MB = 1024 * 1024;

export const FORMAT_DESCRIPTORS: Readonly<Record<UploadFormat, FormatDescriptor>> = {
  // `%PDF`
  pdf: {
    format: "pdf",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    signature: [0x25, 0x50, 0x44, 0x46],
    maxBytes: 120 * MB,
  },
  // `PK\x03\x04` — a ZIP, which is what a DOCX is.
  docx: {
    format: "docx",
    extensions: [".docx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    signature: [0x50, 0x4b, 0x03, 0x04],
    maxBytes: 60 * MB,
  },
  // `\xFF\xD8\xFF` — a field photograph off a phone camera.
  jpeg: {
    format: "jpeg",
    extensions: [".jpg", ".jpeg"],
    mimeTypes: ["image/jpeg"],
    signature: [0xff, 0xd8, 0xff],
    maxBytes: 25 * MB,
  },
  // `\x89PNG`
  png: {
    format: "png",
    extensions: [".png"],
    mimeTypes: ["image/png"],
    signature: [0x89, 0x50, 0x4e, 0x47],
    maxBytes: 25 * MB,
  },
};

/** What a document may be. A field photograph is not a document and vice versa. */
export const DOCUMENT_FORMATS: ReadonlyArray<UploadFormat> = ["pdf", "docx"];
export const FIELD_MEDIA_FORMATS: ReadonlyArray<UploadFormat> = ["jpeg", "png"];

export function formatForMimeType(mimeType: string): UploadFormat | null {
  const normalised = mimeType.trim().toLowerCase().split(";")[0] ?? "";
  for (const descriptor of Object.values(FORMAT_DESCRIPTORS)) {
    if (descriptor.mimeTypes.includes(normalised)) return descriptor.format;
  }
  return null;
}

export function extensionOf(filename: string): string {
  const at = filename.lastIndexOf(".");
  return at === -1 ? "" : filename.slice(at).toLowerCase();
}

export class UnsupportedUpload extends InvalidInput {
  constructor(
    reason: string,
    readonly detail: Readonly<Record<string, string | number>>,
  ) {
    super(`this file cannot be accepted: ${reason}`);
    this.name = "UnsupportedUpload";
  }
}

/**
 * What the *client* claimed, checked before a single byte is presigned.
 *
 * The declared type has to be on the allowlist for this namespace, the extension has to match it,
 * and the declared size has to be inside the format's limit. None of this proves anything about
 * the bytes — that is `assertBytesMatchFormat`, at finalize — but refusing here means an
 * unacceptable upload never gets a URL at all.
 */
export function assertDeclaredUploadAllowed(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  allowed: ReadonlyArray<UploadFormat>;
}): FormatDescriptor {
  const format = formatForMimeType(input.mimeType);
  if (format === null || !input.allowed.includes(format)) {
    throw new UnsupportedUpload("its type is not one this surface accepts", {
      mimeType: input.mimeType,
    });
  }
  const descriptor = FORMAT_DESCRIPTORS[format];
  const extension = extensionOf(input.filename);
  if (!descriptor.extensions.includes(extension)) {
    throw new UnsupportedUpload("its name and its type disagree", {
      extension,
      mimeType: input.mimeType,
    });
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new UnsupportedUpload("its size is not a positive whole number of bytes", {
      sizeBytes: input.sizeBytes,
    });
  }
  if (input.sizeBytes > descriptor.maxBytes) {
    throw new UnsupportedUpload("it is larger than this format allows", {
      sizeBytes: input.sizeBytes,
      maxBytes: descriptor.maxBytes,
    });
  }
  return descriptor;
}

/**
 * What the **bytes** are, checked after the object exists.
 *
 * This is the check the renamed `.exe` fails. It reads the head of the stored object rather than
 * trusting the type the client declared, because the client declared the type *and* uploaded the
 * bytes and there is no reason the two must agree.
 */
export function assertBytesMatchFormat(head: Uint8Array, format: UploadFormat): void {
  const { signature } = FORMAT_DESCRIPTORS[format];
  if (head.length < signature.length) {
    throw new UnsupportedUpload("it is too short to be the format it claims", {
      bytes: head.length,
    });
  }
  for (const [index, byte] of signature.entries()) {
    if (head[index] !== byte) {
      throw new UnsupportedUpload("its contents are not the format it claims", { format });
    }
  }
}

/**
 * Bounds on reading a ZIP container, so a small upload cannot become a large allocation.
 *
 * A 40 KB archive that expands to a gigabyte is not a malformed file; it is a file doing exactly
 * what the format allows. The extractor reads entries under these limits and stops, rather than
 * trusting that a document nobody wrote is a reasonable size.
 */
export const ARCHIVE_LIMITS = {
  /** Total uncompressed bytes the extractor will read out of one container. */
  maxUncompressedBytes: 200 * MB,
  /** Entries it will open. A document does not have ten thousand parts. */
  maxEntries: 2_000,
  /** Uncompressed ÷ compressed, above which the container is refused rather than read. */
  maxCompressionRatio: 200,
} as const;

export function assertArchiveWithinLimits(input: {
  entries: number;
  compressedBytes: number;
  uncompressedBytes: number;
}): void {
  if (input.entries > ARCHIVE_LIMITS.maxEntries) {
    throw new UnsupportedUpload("it contains more parts than a document has", {
      entries: input.entries,
      maxEntries: ARCHIVE_LIMITS.maxEntries,
    });
  }
  if (input.uncompressedBytes > ARCHIVE_LIMITS.maxUncompressedBytes) {
    throw new UnsupportedUpload("its contents expand beyond what will be read", {
      uncompressedBytes: input.uncompressedBytes,
      maxUncompressedBytes: ARCHIVE_LIMITS.maxUncompressedBytes,
    });
  }
  if (
    input.compressedBytes > 0 &&
    input.uncompressedBytes / input.compressedBytes > ARCHIVE_LIMITS.maxCompressionRatio
  ) {
    throw new UnsupportedUpload("it expands far beyond its size, which no document does", {
      ratio: Math.round(input.uncompressedBytes / input.compressedBytes),
      maxRatio: ARCHIVE_LIMITS.maxCompressionRatio,
    });
  }
}
