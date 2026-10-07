import {
  evidenceFinalizeResponseSchema,
  evidenceIntentResponseSchema,
  fieldPackResponseSchema,
  fieldScopeResponseSchema,
  fieldWorkScopeResponseSchema,
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
  type EvidenceFinalizeResponse,
  type EvidenceIntentResponse,
  type FieldWorkScopeResponse,
  type V4SyncPushResponse,
  type WorkPackResponse,
  type WorkPullResponse,
  v4SyncPushResponseSchema,
  workPackResponseSchema,
  workPullResponseSchema,
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

/* ---------------------------------------------------------------------------------------------
 * Protocol v4 (ADR-041) — the same transport, different paths
 * ------------------------------------------------------------------------------------------ */

/**
 * The v4 calls live at `/api/field/v4/*` and the v3 ones above are untouched.
 *
 * Both sets exist in this build on purpose: `ensureWorkPack` converts a v3 pack a handset was
 * holding when the application was updated, and until that device next reaches a signal it is
 * still running v3's survey work from v3's tables. The v4 calls are what it uses the moment it
 * does reach one.
 */
export async function resolveWorkScope(): Promise<FieldWorkScopeResponse> {
  return fieldWorkScopeResponseSchema.parse(await post("/api/field/v4/scope", {}));
}

export async function downloadWorkPack(input: {
  tenantSlug: string;
  projectSlug: string;
}): Promise<WorkPackResponse> {
  return workPackResponseSchema.parse(await post("/api/field/v4/pack", input));
}

export async function pullWork(input: {
  tenantSlug: string;
  projectSlug: string;
  knownAssignmentIds: ReadonlyArray<string>;
  knownInvitationIds: ReadonlyArray<string>;
}): Promise<WorkPullResponse> {
  return workPullResponseSchema.parse(
    await post("/api/field/v4/pull", {
      ...input,
      knownAssignmentIds: [...input.knownAssignmentIds],
      knownInvitationIds: [...input.knownInvitationIds],
    }),
  );
}

export async function pushWorkCommands(input: {
  tenantSlug: string;
  projectSlug: string;
  commands: ReadonlyArray<unknown>;
}): Promise<V4SyncPushResponse> {
  return v4SyncPushResponseSchema.parse(
    await post("/api/field/v4/sync", { ...input, commands: [...input.commands] }),
  );
}

/**
 * Evidence of a delivery: its own namespace, and therefore its own two calls.
 *
 * Not `/api/field/media/*`, which writes into `field-media`. The namespaces are what keep a
 * delivery photograph out of every query written for a visit's photographs, and out of every
 * public route (ADR-041).
 */
export async function requestEvidenceIntent(input: {
  tenantSlug: string;
  projectSlug: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<EvidenceIntentResponse> {
  return evidenceIntentResponseSchema.parse(await post("/api/field/v4/evidence/intent", input));
}

export async function finalizeEvidenceUpload(input: {
  tenantSlug: string;
  projectSlug: string;
  intentId: string;
  objectKey: string;
}): Promise<EvidenceFinalizeResponse> {
  return evidenceFinalizeResponseSchema.parse(await post("/api/field/v4/evidence/finalize", input));
}
