import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DownloadLink, StoragePort, StoredObject, UploadIntent } from "@eia/domain";

/**
 * The S3 **protocol**, not a provider.
 *
 * The AWS SDK is used because every S3-compatible provider speaks its wire protocol — MinIO in
 * CI, Cloudflare R2 or AWS in production — and writing a signer by hand would be re-implementing
 * SigV4 for no benefit. What matters is that this is the *only* file that knows the SDK exists:
 * `@eia/domain` sees `StoragePort`, and the application's use-cases see the port (ARCHITECTURE
 * §9.1). Swapping the provider is configuration; swapping the protocol would be a second
 * implementation of this interface.
 *
 * `forcePathStyle` is on because MinIO and most self-hosted providers serve `endpoint/bucket/key`
 * rather than a virtual host, and AWS accepts both.
 */
export interface S3StorageConfig {
  readonly bucket: string;
  readonly region: string;
  /** Omitted for AWS itself; set for MinIO, R2 and anything self-hosted. */
  readonly endpoint?: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export function createS3Storage(config: S3StorageConfig): StoragePort {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint, forcePathStyle: true }),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  const Bucket = config.bucket;

  return {
    async presignUpload({ key, contentType, maxBytes, ttlSeconds }): Promise<UploadIntent> {
      /*
       * The content type is signed into the URL, so a client that PUTs something else gets a
       * signature failure from the provider rather than an object of a type nobody authorised.
       * `ContentLength` is *not* signed: providers differ on whether they enforce it, and a
       * constraint that only some enforce is one this product would be relying on by accident.
       * The size ceiling is checked against what is actually stored, at finalize (ADR-031 §4).
       */
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }),
        { expiresIn: ttlSeconds },
      );
      return {
        key,
        url,
        method: "PUT",
        headers: { "content-type": contentType },
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        maxBytes,
      };
    },

    async presignDownload(key, ttlSeconds, filename): Promise<DownloadLink> {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          // The key carries no filename, so the delivered name is restored here, in a header the
          // signature covers. Quotes and backslashes are stripped rather than escaped: a download
          // name is a convenience, and the safe version of an odd one is a plainer one.
          ...(filename === undefined
            ? {}
            : {
                ResponseContentDisposition: `attachment; filename="${filename.replaceAll(/["\\\r\n]/g, "")}"`,
              }),
        }),
        { expiresIn: ttlSeconds },
      );
      return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
    },

    async head(key): Promise<StoredObject | null> {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          key,
          sizeBytes: Number(result.ContentLength ?? 0),
          contentType: result.ContentType ?? null,
          // Returned as the provider's own entity tag and never treated as a content hash: for a
          // multipart upload it is a digest of digests (ADR-031 §4).
          etag: result.ETag?.replaceAll('"', "") ?? null,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async get(key): Promise<Uint8Array> {
      const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      const body = result.Body;
      if (!body) throw new Error(`storage: ${key} returned no body`);
      return new Uint8Array(await body.transformToByteArray());
    },

    async remove(key): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const named = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return named.name === "NotFound" || named.$metadata?.httpStatusCode === 404;
}
