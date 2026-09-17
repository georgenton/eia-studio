/**
 * The S3-compatible object storage boundary (SECURITY.md §7, ADR-031).
 *
 * ## Provider-neutral by construction
 *
 * The port speaks in keys, sizes and content types. No bucket name, no endpoint, no region, no
 * credential and no SDK type crosses it, so `@eia/domain` stays a package that could be read by
 * somebody who has never heard of S3 — and swapping R2 for MinIO for AWS is a different
 * implementation of this interface rather than a change to anything that uses it (ARCHITECTURE
 * §9.1).
 *
 * ## Why the intent is a first-class thing
 *
 * Large files do not go through the application. The client asks for an **upload intent**, the
 * server decides the key, the type, the size ceiling and how long the permission lasts, and the
 * client PUTs directly to the provider. The intent is the whole authorization decision, made once
 * and expressed as a short-lived URL; there is no second endpoint the client could reach with a
 * key of its own choosing.
 *
 * ## Why `head` exists, and why `etag` is not a checksum
 *
 * An upload is not trusted because the client said it worked. Finalize asks the provider what is
 * actually there, and compares. `etag` is returned as what it is — the provider's own entity tag,
 * which for a multipart upload is not the MD5 of anything and never a SHA-256. Where this product
 * needs a content hash it computes one from the bytes (ADR-031 §4).
 */
export interface UploadIntent {
  /** The key the server chose. The client echoes it back and never invents one. */
  readonly key: string;
  readonly url: string;
  readonly method: "PUT";
  /** Headers the client must send for the signature to hold — content type, at least. */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
  readonly maxBytes: number;
}

export interface DownloadLink {
  readonly url: string;
  readonly expiresAt: Date;
}

/** What the provider says is actually stored, as opposed to what a client claimed to store. */
export interface StoredObject {
  readonly key: string;
  readonly sizeBytes: number;
  readonly contentType: string | null;
  /**
   * The provider's entity tag. Useful for change detection and **not** a content hash: for a
   * multipart upload it is a digest of digests, and pretending otherwise would put a value in a
   * `sha256` column that no reader could reproduce.
   */
  readonly etag: string | null;
}

export interface StoragePort {
  presignUpload(input: {
    key: string;
    contentType: string;
    maxBytes: number;
    ttlSeconds: number;
  }): Promise<UploadIntent>;
  /**
   * `filename` is the name the browser should save the file under. It is deliberately not part of
   * the key (ADR-031 §1) — a bucket listing is not where a parcel owner's surname goes — so it is
   * supplied here, per link, and reaches the client only after RLS has already shown them the row.
   */
  presignDownload(key: string, ttlSeconds: number, filename?: string): Promise<DownloadLink>;
  /** `null` when nothing is stored under the key. */
  head(key: string): Promise<StoredObject | null>;
  /** Read an object back — for verification at finalize, and for the extraction worker. */
  get(key: string): Promise<Uint8Array>;
  /** Only ever called for an object this product wrote and then refused. */
  remove(key: string): Promise<void>;
}

/**
 * How long an upload permission lasts.
 *
 * Fifteen minutes is the ceiling SECURITY.md §12 already sets for presigned URLs, and a document
 * upload does not need more: the client has the URL the moment it asks, and a link that outlives
 * the person's session is a link somebody else can use.
 */
export const UPLOAD_INTENT_TTL_SECONDS = 900;
export const DOWNLOAD_LINK_TTL_SECONDS = 300;
