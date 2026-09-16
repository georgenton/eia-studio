import { z } from "zod";

/**
 * The wire between EIA Field (React Native) and EIA Studio.
 *
 * ## Why this package exists at all
 *
 * The mobile bundle must not contain a PostgreSQL driver, Drizzle, `node:` anything or a line of
 * server code, and the server must not hand-roll a second copy of the shapes the device sends.
 * This package is the only thing both sides import: zod schemas, vocabularies and DTOs, with no
 * dependency but zod. A lint boundary and a test keep it that way.
 *
 * ## Why commands and not rows
 *
 * A generic row synchroniser would have to decide, on the device, what a write *means* — and the
 * meaning is exactly what this product's domain owns: a submitted response is immutable, an
 * assignment transitions through a fixed machine, a visit belongs to a technician. So the device
 * sends **domain commands** that name an intent, and the server executes the same use-cases the
 * web app calls. Nothing on the device can write a row the web app could not have written.
 *
 * ## Why every command carries an id the device chose
 *
 * A retry is the ordinary case, not the exception: a technician's connection returns for four
 * seconds in a valley. `commandId` is generated once, on the device, when the intent is formed,
 * and never regenerated — so the *same* intent retried ten times is one command ten times, and
 * the server can recognise it. The zero-duplicate invariant rests on this and on the receipt
 * table that remembers it.
 */

/** Bumped when a command's meaning changes in a way an old device could get wrong. */
export const FIELD_SYNC_PROTOCOL_VERSION = 1;

/** Bumped when the Field Pack's shape changes; a device with an older pack re-downloads. */
export const FIELD_PACK_SCHEMA_VERSION = 1;

const uuid = z.string().uuid();
/** Device clock. Recorded as *what the device believed*, never as the workflow's own timestamp. */
const deviceInstant = z.iso.datetime();

/* ---------------------------------------------------------------------------------------------
 * The Field Pack — everything one technician needs to work with no network, and nothing else.
 * ------------------------------------------------------------------------------------------ */

export const packOptionSchema = z
  .object({
    code: z.string().min(1).max(40),
    label: z.string().min(1).max(200),
    ordinal: z.number().int().nonnegative(),
  })
  .strict();
export type PackOption = z.infer<typeof packOptionSchema>;

/**
 * A question in every language the version was published in.
 *
 * `prompt` and the options' `label` are the canonical `es-EC` wording; `translations` carries the
 * rest, keyed by locale and — for options — by **option code**. That keying is the whole point: a
 * technician switching language offline changes what the screen says and nothing about what an
 * answer means, because an answer points at a code that no translation touches (ADR-029).
 */
export const packQuestionTranslationSchema = z
  .object({
    prompt: z.string().min(1).max(500),
    helpText: z.string().max(500).nullable(),
    options: z.record(z.string().min(1).max(40), z.string().min(1).max(200)),
  })
  .strict();
export type PackQuestionTranslation = z.infer<typeof packQuestionTranslationSchema>;

export const packQuestionSchema = z
  .object({
    code: z.string().min(1).max(40),
    ordinal: z.number().int().nonnegative(),
    type: z.string().min(1).max(40),
    prompt: z.string().min(1).max(500),
    helpText: z.string().max(500).nullable(),
    required: z.boolean(),
    sensitivity: z.string().min(1).max(40),
    options: z.array(packOptionSchema),
    translations: z.record(z.string().min(2).max(10), packQuestionTranslationSchema),
  })
  .strict();
export type PackQuestion = z.infer<typeof packQuestionSchema>;

export const packSurveyVersionSchema = z
  .object({
    id: uuid,
    versionLabel: z.string().min(1).max(40),
    templateName: z.string().min(1).max(200),
    /** Always `PUBLISHED`; a draft can still change under the answers it collects. */
    status: z.literal("PUBLISHED"),
    questions: z.array(packQuestionSchema),
  })
  .strict();
export type PackSurveyVersion = z.infer<typeof packSurveyVersionSchema>;

/**
 * The parcel, as a technician needs to *find* it — and no more.
 *
 * A business code, where it sits along the corridor, and which side of the road. No owner, no
 * deed, no household coordinate, no area, no geometry: a technician is told which parcel to visit,
 * not who lives there. The absence is structural, not a filter.
 */
export const packParcelContextSchema = z
  .object({
    parcelId: uuid,
    parcelCode: z.string().min(1).max(40),
    sectorLabel: z.string().max(120).nullable(),
    /**
     * Metres along the alignment, already formatted (`2+840`) by the server.
     *
     * Formatted, unlike `side`, because an abscissa is surveying notation rather than language: it
     * is written the same way for either reader, so there is nothing for the phone to decide.
     */
    chainageLabel: z.string().max(40).nullable(),
    /** The stored value (`left` / `right` / `both`); the phone puts it into its own language. */
    side: z.enum(["left", "right", "both"]).nullable(),
  })
  .strict();
export type PackParcelContext = z.infer<typeof packParcelContextSchema>;

export const packAssignmentSchema = z
  .object({
    id: uuid,
    status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
    parcel: packParcelContextSchema,
    /** The open visit the server already knows about, when there is one. */
    openVisitId: uuid.nullable(),
    /** The response the server already holds for this assignment, when there is one. */
    instanceId: uuid.nullable(),
    instanceStatus: z.enum(["IN_PROGRESS", "SUBMITTED"]).nullable(),
    /** Server revision of this assignment's mutable state; a pull compares it. */
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type PackAssignment = z.infer<typeof packAssignmentSchema>;

export const packCampaignSchema = z
  .object({
    id: uuid,
    name: z.string().min(1).max(200),
    status: z.enum(["DRAFT", "ACTIVE", "CLOSED"]),
    captureChannel: z.string().min(1).max(40),
    offlineMode: z.enum(["disabled", "optional", "required"]),
    surveyVersion: packSurveyVersionSchema,
  })
  .strict();
export type PackCampaign = z.infer<typeof packCampaignSchema>;

export const packProjectSchema = z
  .object({
    tenantId: uuid,
    tenantSlug: z.string().min(1).max(80),
    tenantName: z.string().min(1).max(200),
    projectId: uuid,
    projectSlug: z.string().min(1).max(80),
    projectName: z.string().min(1).max(200),
    locality: z.string().max(200).nullable(),
  })
  .strict();
export type PackProject = z.infer<typeof packProjectSchema>;

/**
 * How long the device may keep working with no server contact, and why it is the pack that says.
 *
 * A disconnected device cannot learn that an account was suspended; nothing can change that. What
 * it *can* do is refuse to be useful for ever. The server stamps the window it is prepared to
 * stand behind — never longer than the session that produced the pack — and the device stops
 * offering capture when it lapses, whether or not it has ever been online since.
 */
export const packValiditySchema = z
  .object({
    issuedAt: z.iso.datetime(),
    /** After this instant the device refuses offline capture until it syncs again. */
    expiresAt: z.iso.datetime(),
    /** What the window was derived from, in words, for the diagnostics screen. */
    basis: z.string().min(1).max(200),
  })
  .strict();
export type PackValidity = z.infer<typeof packValiditySchema>;

export const fieldPackSchema = z
  .object({
    schemaVersion: z.literal(FIELD_PACK_SCHEMA_VERSION),
    protocolVersion: z.literal(FIELD_SYNC_PROTOCOL_VERSION),
    /** The authenticated technician, resolved server-side. Never sent by the device. */
    technician: z
      .object({ userId: uuid, email: z.email(), name: z.string().max(200).nullable() })
      .strict(),
    project: packProjectSchema,
    campaign: packCampaignSchema,
    assignments: z.array(packAssignmentSchema),
    validity: packValiditySchema,
    /** Opaque; handed back on the next pull so the server can send only what changed. */
    cursor: z.string().min(1).max(200),
  })
  .strict();
export type FieldPack = z.infer<typeof fieldPackSchema>;

/**
 * A technician with nothing to do gets a legible answer rather than an empty pack.
 *
 * The distinction matters offline: "you have no active campaign" is a fact the device should show
 * and keep showing, and it is not the same as "the download failed".
 */
export const fieldPackResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pack"), pack: fieldPackSchema }).strict(),
  z
    .object({
      kind: z.literal("no_work"),
      reason: z.enum(["no_active_campaign", "no_assignments", "no_project_membership"]),
      message: z.string().min(1).max(400),
    })
    .strict(),
]);
export type FieldPackResponse = z.infer<typeof fieldPackResponseSchema>;

/* ---------------------------------------------------------------------------------------------
 * Commands — what the device asks the server to do, once connectivity returns.
 * ------------------------------------------------------------------------------------------ */

export const COMMAND_TYPES = [
  "visit.start",
  "survey.upsert_draft",
  "survey.submit",
  "visit.finish",
] as const;
export const commandTypeSchema = z.enum(COMMAND_TYPES);
export type CommandType = z.infer<typeof commandTypeSchema>;

/**
 * One answer, in **exactly** the shape `@eia/domain`'s `answerInputSchema` already validates.
 *
 * Restated here rather than imported so this package keeps its single dependency and the wire can
 * be versioned separately from the domain's internals — but restated *identically*, member for
 * member, because a wire format that is a near-miss of the domain's is worse than either: the
 * mapping between them becomes a place where `MULTI_CHOICE` quietly loses its second option.
 * `packages/field-sync-contract/test/protocol.test.ts` fails if the two ever diverge.
 */
export const wireAnswerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string().max(4000) }).strict(),
  z.object({ kind: z.literal("number"), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("date"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ kind: z.literal("option"), optionCode: z.string().min(1).max(40) }).strict(),
  z
    .object({ kind: z.literal("options"), optionCodes: z.array(z.string().min(1).max(40)).max(50) })
    .strict(),
  z.object({ kind: z.literal("blank") }).strict(),
]);
export type WireAnswer = z.infer<typeof wireAnswerSchema>;

export const wireLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyM: z.number().positive().max(100_000).nullable(),
    capturedAt: deviceInstant,
  })
  .strict();
export type WireLocation = z.infer<typeof wireLocationSchema>;

const visitStartPayload = z
  .object({
    assignmentId: uuid,
    location: wireLocationSchema.nullable(),
    locationOutcome: z.enum(["captured", "denied", "unavailable", "not_attempted"]),
  })
  .strict();

const surveyDraftPayload = z
  .object({
    assignmentId: uuid,
    /** The server's visit id, once the device has one. Null while `visit.start` is unacknowledged. */
    visitId: uuid.nullable(),
    /** The version the device downloaded. The server refuses a mismatch rather than reinterpreting. */
    surveyVersionId: uuid,
    answers: z.record(z.string().min(1).max(40), wireAnswerSchema),
  })
  .strict();

const visitFinishPayload = z.object({ assignmentId: uuid, visitId: uuid }).strict();

/**
 * The envelope every command shares.
 *
 * `deviceRevision` orders a device's own edits to one entity: draft 3 arriving after draft 5 is
 * stale and is acknowledged as superseded rather than applied, which is what stops a slow retry
 * from resurrecting older answers. It is not a vector clock and does not try to order two devices
 * against each other — one technician holds one assignment, and that is the invariant that makes
 * a single counter sufficient.
 */
const envelope = {
  commandId: uuid,
  protocolVersion: z.literal(FIELD_SYNC_PROTOCOL_VERSION),
  /** Rising per entity, per device. Compared only within one entity. */
  deviceRevision: z.number().int().nonnegative(),
  /** When the technician did the thing, by the device's clock. Never the workflow's timestamp. */
  occurredAt: deviceInstant,
  /** For the diagnostics screen and for reading an incident afterwards. */
  appVersion: z.string().min(1).max(40),
  packSchemaVersion: z.number().int().positive(),
} as const;

export const syncCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...envelope, type: z.literal("visit.start"), payload: visitStartPayload }).strict(),
  z
    .object({ ...envelope, type: z.literal("survey.upsert_draft"), payload: surveyDraftPayload })
    .strict(),
  z.object({ ...envelope, type: z.literal("survey.submit"), payload: surveyDraftPayload }).strict(),
  z.object({ ...envelope, type: z.literal("visit.finish"), payload: visitFinishPayload }).strict(),
]);
export type SyncCommand = z.infer<typeof syncCommandSchema>;

/** One push carries a bounded batch: a failure should cost a round trip, not a day's work. */
export const SYNC_PUSH_LIMIT = 50;

export const syncPushRequestSchema = z
  .object({
    /** Resolved server-side against the session's memberships; a forged pair is refused. */
    tenantSlug: z.string().min(1).max(80),
    projectSlug: z.string().min(1).max(80),
    commands: z.array(syncCommandSchema).min(1).max(SYNC_PUSH_LIMIT),
  })
  .strict();
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

/* ---------------------------------------------------------------------------------------------
 * Results — what the device learns about each command it sent.
 * ------------------------------------------------------------------------------------------ */

/**
 * Four outcomes, and the difference between them is the whole protocol.
 *
 * `applied` — the server did it now.
 * `duplicate` — it had already done exactly this command; the stored result is replayed.
 * `superseded` — the intent is obsolete (a stale draft revision, or a draft behind a submit). The
 *   device must **stop retrying** and mark the work done, because retrying forever is how a queue
 *   becomes permanently stuck on something that can never succeed.
 * `conflict` — the server will not do it and a person has to look. The device keeps the local
 *   work untouched and says so on screen.
 * `rejected` — the command is malformed or not permitted. Terminal, and never silently dropped.
 */
export const COMMAND_OUTCOMES = [
  "applied",
  "duplicate",
  "superseded",
  "conflict",
  "rejected",
] as const;
export const commandOutcomeSchema = z.enum(COMMAND_OUTCOMES);
export type CommandOutcome = z.infer<typeof commandOutcomeSchema>;

/** Outcomes the device must never retry. Everything else may be sent again. */
export const TERMINAL_OUTCOMES: ReadonlyArray<CommandOutcome> = [
  "applied",
  "duplicate",
  "superseded",
  "conflict",
  "rejected",
];

export const CONFLICT_REASONS = [
  "assignment_reassigned",
  "assignment_cancelled",
  "survey_version_changed",
  "campaign_closed",
  "submitted_server_side",
] as const;
export const conflictReasonSchema = z.enum(CONFLICT_REASONS);
export type ConflictReason = z.infer<typeof conflictReasonSchema>;

export const commandResultSchema = z
  .object({
    commandId: uuid,
    outcome: commandOutcomeSchema,
    /** Server ids the device stores so later commands can name them. */
    visitId: uuid.nullable(),
    instanceId: uuid.nullable(),
    instanceStatus: z.enum(["IN_PROGRESS", "SUBMITTED"]).nullable(),
    assignmentStatus: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).nullable(),
    conflictReason: conflictReasonSchema.nullable(),
    /** Spanish, shown to the technician. Never a stack trace and never an answer. */
    message: z.string().max(400).nullable(),
  })
  .strict();
export type CommandResult = z.infer<typeof commandResultSchema>;

export const syncPushResponseSchema = z
  .object({
    protocolVersion: z.literal(FIELD_SYNC_PROTOCOL_VERSION),
    results: z.array(commandResultSchema),
    /** Hand this back on the next pull. */
    cursor: z.string().min(1).max(200),
  })
  .strict();
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

/* ---------------------------------------------------------------------------------------------
 * Pull — what changed on the server that this technician's device needs to know.
 * ------------------------------------------------------------------------------------------ */

export const syncPullRequestSchema = z
  .object({
    tenantSlug: z.string().min(1).max(80),
    projectSlug: z.string().min(1).max(80),
    /** From the last pack or push. Absent means "everything currently assigned to me". */
    cursor: z.string().min(1).max(200).nullable(),
  })
  .strict();
export type SyncPullRequest = z.infer<typeof syncPullRequestSchema>;

/**
 * Deliberately narrow. The device is told about its own assignments, its campaign and the validity
 * of its pack — not about the project's responses, its findings, its documents or anybody else's
 * work. A full offline replica of a project is a different product and a much larger risk.
 */
export const syncPullResponseSchema = z
  .object({
    protocolVersion: z.literal(FIELD_SYNC_PROTOCOL_VERSION),
    campaignStatus: z.enum(["DRAFT", "ACTIVE", "CLOSED"]),
    /** The version the campaign names now. A change is a conflict for open drafts, not a rewrite. */
    surveyVersionId: uuid,
    assignments: z.array(packAssignmentSchema),
    /** Assignments that are no longer this technician's, by id. */
    revokedAssignmentIds: z.array(uuid),
    validity: packValiditySchema,
    cursor: z.string().min(1).max(200),
  })
  .strict();
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;

/* ---------------------------------------------------------------------------------------------
 * Local sync vocabulary — shared so the device's states and the server's outcomes cannot drift.
 * ------------------------------------------------------------------------------------------ */

/**
 * What the technician sees about one survey, and the one distinction that must never blur:
 * `READY_TO_SYNC` is *sent on the device*, `SYNCED` is *the server has it*.
 */
export const LOCAL_SURVEY_STATES = [
  "NOT_STARTED",
  "DRAFT",
  "READY_TO_SYNC",
  "SYNCING",
  "SYNCED",
  "SYNC_ERROR",
  "CONFLICT",
] as const;
export const localSurveyStateSchema = z.enum(LOCAL_SURVEY_STATES);
export type LocalSurveyState = z.infer<typeof localSurveyStateSchema>;

/*
 * The words for a local state or a conflict reason live in `@eia/i18n`
 * (`mobile.localSurveyState.*`, `mobile.conflictReason.*`), not on the wire. This package is the
 * contract between a phone and a server, and a contract that carried one language's copy would
 * make the protocol version change every time a sentence was reworded — and would leave the
 * English half of the product speaking Spanish.
 */
