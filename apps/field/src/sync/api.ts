import {
  fieldPackResponseSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type FieldPackResponse,
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
