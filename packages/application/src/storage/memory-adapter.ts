import type { DownloadLink, StoragePort, StoredObject, UploadIntent } from "@eia/domain";

/**
 * An in-memory store, for tests and for a laptop with no bucket.
 *
 * It is a real implementation of the port — a `PUT` to the URL it hands out stores bytes that
 * `head` and `get` then see — so a test exercises the same *use-case* path a provider does. What
 * it deliberately is not is a stand-in for a provider in a persistent environment:
 * `resolveStorageAvailability` refuses `memory` outside `local` and `test`, because a document
 * version whose bytes lived in a process that has since exited is a citation nobody can resolve
 * and looks exactly like one that can.
 *
 * The "presigned" URL is a `data:`-shaped token this store recognises and nothing else does. It
 * cannot be uploaded to by a browser, which is correct: the environments that use this store have
 * no browser uploading to a provider either.
 */
export interface MemoryStorage extends StoragePort {
  /** Put bytes directly, standing in for the client's PUT to the presigned URL. */
  /**
   * The port's write, and the local stand-in for a browser's PUT.
   *
   * `StoragePort.put` is async; this store answers immediately, so the signature widens to a
   * promise while callers that already use it synchronously keep working.
   */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  keys(): ReadonlyArray<string>;
}

export function createMemoryStorage(): MemoryStorage {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  return {
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType });
      return Promise.resolve();
    },
    keys() {
      return [...objects.keys()];
    },
    async presignUpload({ key, contentType, maxBytes, ttlSeconds }): Promise<UploadIntent> {
      return Promise.resolve({
        key,
        url: `memory://upload/${encodeURIComponent(key)}`,
        method: "PUT",
        headers: { "content-type": contentType },
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        maxBytes,
      });
    },
    async presignDownload(key, ttlSeconds): Promise<DownloadLink> {
      return Promise.resolve({
        url: `memory://download/${encodeURIComponent(key)}`,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      });
    },
    async head(key): Promise<StoredObject | null> {
      const stored = objects.get(key);
      if (!stored) return Promise.resolve(null);
      return Promise.resolve({
        key,
        sizeBytes: stored.bytes.byteLength,
        contentType: stored.contentType,
        // No entity tag: this store has no opinion about one, and inventing a value that looked
        // like a checksum is exactly what the port's comment warns against.
        etag: null,
      });
    },
    async get(key): Promise<Uint8Array> {
      const stored = objects.get(key);
      if (!stored) throw new Error(`storage: ${key} is not stored`);
      return Promise.resolve(stored.bytes);
    },
    async remove(key): Promise<void> {
      objects.delete(key);
      return Promise.resolve();
    },
  };
}
