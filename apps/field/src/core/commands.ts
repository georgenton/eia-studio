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
