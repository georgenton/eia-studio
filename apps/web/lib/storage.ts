import "server-only";

import { createMemoryStorage, createS3Storage, type StorageReadiness } from "@eia/application";
import type { StoragePort } from "@eia/domain";

import { getEnv } from "./env";

/**
 * The object store this deployment can actually use, or `null`.
 *
 * `null` is not an outage and never a reason to fail a request that stores nothing: it is the
 * answer to *may a file be stored here at all*, decided once by `resolveStorageAvailability`
 * (ADR-031). A caller that needs a store checks for `null` and renders the reason; a caller that
 * does not never asks. There is deliberately no fallback — an unset provider does not become the
 * in-memory store, because a `DocumentVersion` whose bytes lived in a process that has since
 * exited is a citation nobody can resolve and looks exactly like one that can.
 *
 * One instance per process, on `globalThis` because Next.js reloads modules in development. The
 * memory store is stateful, so a second instance would lose the bytes of the first.
 */
const globalRef = globalThis as unknown as { __eiaStorage?: StoragePort | null };

export function getStorage(): StoragePort | null {
  if (globalRef.__eiaStorage !== undefined) return globalRef.__eiaStorage;
  globalRef.__eiaStorage = buildStorage();
  return globalRef.__eiaStorage;
}

function buildStorage(): StoragePort | null {
  const env = getEnv();
  if (env.storage.state !== "AVAILABLE") return null;
  if (env.storage.provider === "memory") return createMemoryStorage();

  const { bucket, region, endpoint, accessKeyId, secretAccessKey } = env.storageConfig;
  /*
   * Unreachable: `AVAILABLE` with provider `s3` is exactly the case where the resolver found all
   * four. The assertion is here so that a future change to the resolver fails loudly rather than
   * constructing a client with `undefined` credentials, which signs URLs that are refused at the
   * moment somebody uploads a file.
   */
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error("storage: resolved AVAILABLE for s3 without a full configuration");
  }

  return createS3Storage({
    bucket,
    region,
    ...(endpoint === undefined ? {} : { endpoint }),
    accessKeyId,
    secretAccessKey,
  });
}

/**
 * Whether a file could be stored here, in the shape the readiness report wants.
 *
 * The *reason* travels and the operator-facing detail does not: that text names environment
 * variables and belongs in a log, not on a consultant's screen (ADR-031 §5).
 */
export function storageReadiness(): StorageReadiness {
  const storage = getEnv().storage;
  return storage.state === "AVAILABLE"
    ? { available: true, reason: null }
    : { available: false, reason: storage.reason };
}
