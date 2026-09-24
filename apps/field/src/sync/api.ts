import {
  fieldPackResponseSchema,
  fieldScopeResponseSchema,
  mediaFinalizeResponseSchema,
  mediaIntentResponseSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type FieldPackResponse,
  type FieldScopeResponse,
  type MediaFinalizeResponse,
  type MediaIntentResponse,
  type SyncCommand,
  type SyncPullResponse,
  type SyncPushResponse,
} from "@eia/field-sync-contract";

import { authHeaders } from "../auth/client";
import { fieldConfig } from "../config";

/**
 * The three calls this application makes, and how it tells "the server said no" from "the server
 * was not there".
 *
 * That distinction is the whole of offline behaviour. A `TransportError` means *try again later*
 * and the outbox keeps its command; anything the server actually answered is a decision the device
 * must act on and stop retrying. Conflating them is how a queue either loses work or never drains.
 */
export class TransportError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "TransportError";
  }
}

export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`${status}: ${detail}`);
    this.name = "ServerError";
  }
}

const TIMEOUT_MS = 30_000;

async function post(path: string, body: unknown): Promise<unknown> {
  const config = fieldConfig();
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // No response at all: DNS, TCP, TLS, timeout, aeroplane mode. Retryable, always.
    throw new TransportError(error instanceof Error ? error.message : "sin conexión");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ServerError(response.status, detail.slice(0, 300));
  }
  return response.json();
}

/**
 * Asked once, by a device that holds no pack: *whose work am I here to do?*
 *
 * Every other call here names a tenant and a project because the pack already said which. This is
 * the one that comes before it, and it sends nothing at all — the session is the whole question.
 */
export async function resolveFieldScope(): Promise<FieldScopeResponse> {
  return fieldScopeResponseSchema.parse(await post("/api/field/scope", {}));
}

export async function downloadFieldPack(input: {
  tenantSlug: string;
  projectSlug: string;
}): Promise<FieldPackResponse> {
  return fieldPackResponseSchema.parse(await post("/api/field/pack", input));
}

export async function pushCommands(input: {
  tenantSlug: string;
  projectSlug: string;
  commands: ReadonlyArray<SyncCommand>;
}): Promise<SyncPushResponse> {
  return syncPushResponseSchema.parse(
    await post("/api/field/sync", { ...input, commands: [...input.commands] }),
  );
}

export async function pullChanges(input: {
  tenantSlug: string;
  projectSlug: string;
  cursor: string | null;
  knownAssignmentIds: ReadonlyArray<string>;
}): Promise<SyncPullResponse> {
  return syncPullResponseSchema.parse(
    await post("/api/field/pull", { ...input, knownAssignmentIds: [...input.knownAssignmentIds] }),
  );
}

/* ---------------------------------------------------------------------------------------------
 * Media upload — the two calls whose payload is not JSON (ADR-032)
 * ------------------------------------------------------------------------------------------ */

export async function requestMediaIntent(input: {
  tenantSlug: string;
  projectSlug: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<MediaIntentResponse> {
  return mediaIntentResponseSchema.parse(await post("/api/field/media/intent", input));
}

export async function finalizeMediaUpload(input: {
  tenantSlug: string;
  projectSlug: string;
  intentId: string;
  objectKey: string;
}): Promise<MediaFinalizeResponse> {
  return mediaFinalizeResponseSchema.parse(await post("/api/field/media/finalize", input));
}

/**
 * The bytes, straight to the provider.
 *
 * Deliberately **not** through `post`: there is no session on this request and there must not be
 * one. The only authorisation is the signature the provider put in the URL, which is why its life
 * is measured in minutes — sending a session cookie to a storage vendor would hand them a
 * credential for this product (SECURITY.md §7).
 *
 * Uploaded from the file system rather than read into memory: a 4 MB photograph held as a
 * base64 string on a low-end handset is three times its size in a heap that is already tight.
 */
export async function putFileToProvider(input: {
  url: string;
  headers: Record<string, string>;
  fileUri: string;
}): Promise<void> {
  const { uploadAsync, FileSystemUploadType } = await import("expo-file-system/legacy");
  let result: { status: number };
  try {
    result = await uploadAsync(input.url, input.fileUri, {
      httpMethod: "PUT",
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: input.headers,
    });
  } catch (error) {
    throw new TransportError(error instanceof Error ? error.message : "sin conexión");
  }
  if (result.status < 200 || result.status >= 300) {
    // The provider refused the signature or the content type. A decision, not an outage — but the
    // device's answer is the same either way: keep the file, and ask for a fresh intent later.
    throw new ServerError(result.status, "el proveedor rechazó la carga");
  }
}
