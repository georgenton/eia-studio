import {
  FIELD_PACK_SCHEMA_VERSION,
  FIELD_SYNC_PROTOCOL_VERSION,
  syncCommandSchema,
  type SyncCommand,
  type WireAnswer,
  type WireLocation,
} from "@eia/field-sync-contract";

/**
 * Turning a technician's action into the command the server will eventually execute.
 *
 * The `commandId` is generated **once, here, at the moment of intent** and stored with the queued
 * row. It is never regenerated on retry — that is the whole mechanism: the same intent sent five
 * times carries one id five times, and the server's receipt table recognises the second through
 * fifth as the first. A fresh id per attempt would turn every flaky connection into duplicates.
 */
export interface CommandContext {
  readonly appVersion: string;
  /** Rising per entity, per device: orders this device's own edits to one survey. */
  readonly deviceRevision: number;
  readonly occurredAt: Date;
  readonly newId: () => string;
}

function envelope(ctx: CommandContext) {
  return {
    commandId: ctx.newId(),
    protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
    deviceRevision: ctx.deviceRevision,
    occurredAt: ctx.occurredAt.toISOString(),
    appVersion: ctx.appVersion,
    packSchemaVersion: FIELD_PACK_SCHEMA_VERSION,
  } as const;
}

export function visitStartCommand(
  ctx: CommandContext,
  input: {
    readonly assignmentId: string;
    readonly location: WireLocation | null;
    readonly locationOutcome: "captured" | "denied" | "unavailable" | "not_attempted";
  },
): SyncCommand {
  return syncCommandSchema.parse({
    ...envelope(ctx),
    type: "visit.start",
    payload: {
      assignmentId: input.assignmentId,
      location: input.location,
      locationOutcome: input.locationOutcome,
    },
  });
}

export function surveyDraftCommand(
  ctx: CommandContext,
  input: {
    readonly assignmentId: string;
    readonly visitId: string | null;
    readonly surveyVersionId: string;
    readonly answers: Readonly<Record<string, WireAnswer>>;
  },
): SyncCommand {
  return syncCommandSchema.parse({
    ...envelope(ctx),
    type: "survey.upsert_draft",
    payload: { ...input },
  });
}

export function surveySubmitCommand(
  ctx: CommandContext,
  input: {
    readonly assignmentId: string;
    readonly visitId: string | null;
    readonly surveyVersionId: string;
    readonly answers: Readonly<Record<string, WireAnswer>>;
  },
): SyncCommand {
  return syncCommandSchema.parse({
    ...envelope(ctx),
    type: "survey.submit",
    payload: { ...input },
  });
}

export function visitFinishCommand(
  ctx: CommandContext,
  input: { readonly assignmentId: string; readonly visitId: string },
): SyncCommand {
  return syncCommandSchema.parse({
    ...envelope(ctx),
    type: "visit.finish",
    payload: { ...input },
  });
}

/**
 * Declare a photograph whose bytes are already stored and verified (ADR-032).
 *
 * `localId` comes from the row rather than from `newId()`, and that is the difference between this
 * and every other command here: `commandId` identifies *this attempt to tell the server*, and
 * `localId` identifies *the photograph*. A device that lost its outbox and re-formed the command
 * mints a new `commandId` and keeps the old `localId`, so the server still recognises one
 * photograph.
 */
export function mediaDeclareCommand(
  ctx: CommandContext,
  input: {
    readonly assignmentId: string;
    readonly visitId: string;
    readonly localId: string;
    readonly storedObjectId: string;
    readonly kind: "parcel" | "affectation" | "access" | "other";
    readonly note: string | null;
    readonly location: WireLocation | null;
  },
): SyncCommand {
  return syncCommandSchema.parse({
    ...envelope(ctx),
    type: "media.declare",
    payload: {
      assignmentId: input.assignmentId,
      visitId: input.visitId,
      localId: input.localId,
      storedObjectId: input.storedObjectId,
      kind: input.kind,
      // The device's clock at the shutter is the caller's to supply; here it is the moment the
      // intent was formed, which for a photograph is the same instant.
      capturedAt: ctx.occurredAt.toISOString(),
      note: input.note,
      location: input.location,
    },
  });
}

/**
 * A queued command may name a visit the device did not have when the command was formed.
 *
 * The sequence that makes this necessary: a technician starts a visit and fills a survey with no
 * signal at all, so `visit.start` is still queued and unacknowledged when `survey.submit` is
 * formed — there is no server visit id to put in it. When the visit is finally acknowledged the
 * server hands back its id, and the commands still in the queue are patched to name it before they
 * are sent. The `commandId` is untouched, so the patch cannot create a duplicate.
 */
export function withResolvedVisitId(command: SyncCommand, visitId: string): SyncCommand {
  if (command.type !== "survey.upsert_draft" && command.type !== "survey.submit") return command;
  if (command.payload.visitId !== null) return command;
  return { ...command, payload: { ...command.payload, visitId } };
}
