import { mayDeleteLocalFile, type LocalMediaState } from "@eia/domain/mobile";

/**
 * Getting a photograph off a phone, and the rule that the local file is never lost.
 *
 * ## Why this is a state machine and not three awaits
 *
 * Four things must happen in order, over a connection that fails in the middle of any of them: ask
 * for an intent, PUT the bytes, finalize, declare. Written inline, "what happens if the process
 * dies here?" has four different answers and none of them is written down. Written as a machine
 * over a row, there is exactly one answer — *the row says where it got to, and the file is still
 * on the device* — and this module is where it is tested.
 *
 * ## The rule
 *
 * **Never lose the local file before the server has acknowledged the row.** Not after the PUT
 * returns 200: bytes in a bucket are not a `field_media` row, and a finalize that never ran leaves
 * an object nothing points at. Only `media.declare` coming back settled releases the file, and
 * `mayDeleteLocalFile` in the domain is the predicate both sides use.
 *
 * ## Why a retry cannot duplicate
 *
 * `localId` is minted at capture and never regenerated, so the declaration is the same declaration
 * however many times it is sent. The intent may be re-issued — a fresh intent is a fresh key and a
 * fresh object — and that is deliberate: it costs an orphaned object in the bucket, and the
 * alternative (reusing an intent whose PUT may have half-succeeded) costs a photograph. An object
 * nobody points at is a housekeeping problem; a lost photograph is evidence that no longer exists.
 */
export interface LocalMediaRow {
  readonly localId: string;
  readonly assignmentId: string;
  readonly visitId: string | null;
  readonly fileUri: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly state: LocalMediaState;
  /** Set once the bytes are verified server-side; what `media.declare` names. */
  readonly storedObjectId: string | null;
  /** Set when the server acknowledged the declaration. The only thing that releases the file. */
  readonly serverMediaId: string | null;
  readonly attempts: number;
}

export interface MediaTransport {
  requestIntent(input: { filename: string; mimeType: string; sizeBytes: number }): Promise<{
    intentId: string;
    url: string;
    headers: Record<string, string>;
    objectKey: string;
  }>;
  putFile(input: { url: string; headers: Record<string, string>; fileUri: string }): Promise<void>;
  finalize(input: { intentId: string; objectKey: string }): Promise<{ storedObjectId: string }>;
}

export type MediaStep =
  /** The bytes are verified; the declaration is the caller's to queue. */
  | { readonly kind: "ready_to_declare"; readonly storedObjectId: string }
  /** Nothing to do: already uploaded, or waiting for a visit id the device does not have yet. */
  | { readonly kind: "hold"; readonly reason: "already_uploaded" | "no_visit_yet" }
  /** The connection failed. The row keeps its file and its place in the queue. */
  | { readonly kind: "retry"; readonly detail: string };

/**
 * Advance one photograph as far as it can go right now.
 *
 * It never deletes, never queues and never writes: it returns what happened, and the caller — which
 * owns the database — decides. That is what makes it testable without a device, and it is why the
 * failure paths below are the interesting part of this file.
 */
export async function uploadOneMedia(
  row: LocalMediaRow,
  transport: MediaTransport,
): Promise<MediaStep> {
  if (row.serverMediaId !== null) return { kind: "hold", reason: "already_uploaded" };

  /*
   * A photograph taken before `visit.start` was acknowledged has no server visit to belong to.
   * The device holds it — with the file — rather than inventing an id or dropping the capture,
   * exactly as a draft survey waits for the same acknowledgement.
   */
  if (row.visitId === null) return { kind: "hold", reason: "no_visit_yet" };

  // Already verified on a previous attempt: skip straight to the declaration rather than
  // uploading the same bytes again.
  if (row.storedObjectId !== null) {
    return { kind: "ready_to_declare", storedObjectId: row.storedObjectId };
  }

  try {
    const intent = await transport.requestIntent({
      // The filename the server stores beside the row; it is never part of the key (ADR-031 §1).
      filename: `${row.localId}${extensionFor(row.mimeType)}`,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
    });
    await transport.putFile({ url: intent.url, headers: intent.headers, fileUri: row.fileUri });
    const { storedObjectId } = await transport.finalize({
      intentId: intent.intentId,
      objectKey: intent.objectKey,
    });
    return { kind: "ready_to_declare", storedObjectId };
  } catch (error) {
    // Every failure in the sequence is the same answer: keep the file, keep the row, try later.
    // There is no branch that deletes anything, which is the property this module exists to have.
    return { kind: "retry", detail: detailOf(error) };
  }
}

function extensionFor(mimeType: string): string {
  return mimeType === "image/png" ? ".png" : ".jpg";
}

function detailOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Bounded, and never a payload: this reaches the diagnostics screen, which people photograph.
  return text.slice(0, 200);
}

/**
 * Which local files the retention sweep may remove.
 *
 * A separate, boring function on purpose: the sweep is the one piece of this feature that deletes
 * a technician's data, and it must be readable by somebody who does not trust it. It removes a
 * file only when `mayDeleteLocalFile` says the server acknowledged the row.
 */
export function deletableFiles(rows: ReadonlyArray<LocalMediaRow>): ReadonlyArray<LocalMediaRow> {
  return rows.filter((row) => mayDeleteLocalFile(row));
}

/**
 * What the technician is told about a photograph that has not gone yet.
 *
 * `PENDING_UPLOAD` on a phone with no signal is not an error and must not read as one: the
 * photograph is safe, and it will go when there is a connection. The distinction that matters is
 * the same one the survey states make — *on the device* is not *the server has it*.
 */
export function mediaStateFor(row: LocalMediaRow): LocalMediaState {
  if (row.serverMediaId !== null) return "UPLOADED";
  if (row.state === "FAILED") return "FAILED";
  return row.state === "UPLOADING" ? "UPLOADING" : "PENDING_UPLOAD";
}
