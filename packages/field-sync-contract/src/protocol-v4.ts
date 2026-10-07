import { z } from "zod";

import {
  commandOutcomeSchema,
  packAssignmentSchema,
  packCampaignSchema,
  packProjectSchema,
  packValiditySchema,
  wireLocationSchema,
} from "./protocol";

/**
 * Protocol v4: a technician's work is not only surveys (ADR-041).
 *
 * ## Why a second module and not a bigger one
 *
 * Every v3 object is `.strict()`. A field added to one of them is a parse error on a device
 * built against v3 — which is the point of `.strict()`, and the reason the version number
 * exists. So v3 stays exactly as it is, byte for byte, and v4 lives beside it: new endpoints,
 * new literals, and the v3 schemas **reused where the shape is genuinely the same** rather than
 * copied. `packAssignmentSchema` describes an assignment identically in both; re-declaring it
 * would be two definitions of one fact, and the one that drifted would be found on a phone.
 *
 * A device speaking v3 keeps working against `/api/field/*`. A device speaking v4 uses
 * `/api/field/v4/*`. There is no negotiation and no shared body that means two things — the brief
 * for this block asked for clarity over cleverness, and a URL segment is the clearest version
 * marker there is.
 *
 * ## What changed, and why each change needed a version
 *
 * - **Work is a union, not a campaign.** A project with a closed survey campaign and five
 *   pending invitations is a project a technician must be able to work in. v3's pack has a
 *   required `campaign`, so it cannot express that at all; v4's `surveyWork` is nullable.
 * - **Discovery answers with a list.** v3's `/scope` has a terminal `multiple_field_projects`
 *   state, because the app held one pack by database constraint. v4 returns the projects and
 *   lets the person choose, which is the decision that was being withheld from them.
 * - **One new command.** `socialization.delivery.record`, with its own payload and its own
 *   conflict vocabulary.
 */
export const FIELD_SYNC_PROTOCOL_VERSION_V4 = 4;

/** Bumped from 1: the pack's top level is a different object (`surveyWork`, `socializationWork`). */
export const FIELD_PACK_SCHEMA_VERSION_V4 = 2;

const uuid = z.string().uuid();
const deviceInstant = z.iso.datetime();

/* ---------------------------------------------------------------------------------------------
 * Discovery — in which projects do I have work?
 * ------------------------------------------------------------------------------------------ */

export const WORK_KINDS = ["survey", "socialization"] as const;
export const workKindSchema = z.enum(WORK_KINDS);
export type WorkKind = z.infer<typeof workKindSchema>;

export const fieldProjectWithWorkSchema = z
  .object({
    tenantSlug: z.string().min(1).max(80),
    projectSlug: z.string().min(1).max(80),
    projectName: z.string().min(1).max(200),
    /** Which kinds of work are waiting. Both may be present; at least one always is. */
    work: z.array(workKindSchema).min(1),
  })
  .strict();
export type FieldProjectWithWork = z.infer<typeof fieldProjectWithWorkSchema>;

/**
 * Every project this technician has work in — and nothing about the ones they merely belong to.
 *
 * Eligibility is **work**, not membership: an own survey assignment that is `PENDING` or
 * `IN_PROGRESS` in an `ACTIVE` campaign, or an own `PENDING` invitation. A person added to six
 * projects and given work in one has one project here.
 *
 * The list is returned even when it has one entry, so the application decides what to do with
 * one and with five by the same code path. What it must not do is **pick** when there are
 * several: that is a person's choice about whose morning this is.
 */
export const fieldWorkScopeResponseSchema = z
  .object({
    protocolVersion: z.literal(FIELD_SYNC_PROTOCOL_VERSION_V4),
    projects: z.array(fieldProjectWithWorkSchema),
  })
  .strict();
export type FieldWorkScopeResponse = z.infer<typeof fieldWorkScopeResponseSchema>;

/* ---------------------------------------------------------------------------------------------
 * The pack
 * ------------------------------------------------------------------------------------------ */

/**
 * One invitation, as a technician needs to deliver it — and no more.
 *
 * The event's words, the parcel's code, and a label if somebody wrote one. No other parcel of
 * the project, no other technician's invitation, no survey answer, no geometry, no attendance.
 * `revision` is what the device sends back with a delivery, so a reassignment that happened
 * while it was offline is a conflict rather than a silent re-attribution.
 */
export const packInvitationSchema = z
  .object({
    invitationId: uuid,
    revision: z.number().int().positive(),
    status: z.enum(["PENDING", "DELIVERED", "REFUSED", "CANCELLED"]),
    parcelId: uuid,
    parcelCode: z.string().min(1).max(40),
    sectorLabel: z.string().max(120).nullable(),
    /** Already formatted (`2+840`): surveying notation reads the same in either language. */
    chainageLabel: z.string().max(40).nullable(),
    recipientLabel: z.string().max(160).nullable(),
    eventId: uuid,
    eventTitle: z.string().min(1).max(200),
    startsAt: z.iso.datetime(),
    timezone: z.string().min(3).max(60),
    locationLabel: z.string().min(1).max(300),
    purpose: z.string().max(1000).nullable(),
  })
  .strict();
export type PackInvitation = z.infer<typeof packInvitationSchema>;

/** The survey half, absent when the project has no active campaign. */
export const packSurveyWorkSchema = z
  .object({ campaign: packCampaignSchema, assignments: z.array(packAssignmentSchema) })
  .strict();
export type PackSurveyWork = z.infer<typeof packSurveyWorkSchema>;

export const packSocializationWorkSchema = z
  .object({ invitations: z.array(packInvitationSchema) })
  .strict();
export type PackSocializationWork = z.infer<typeof packSocializationWorkSchema>;

/**
 * The v4 pack.
 *
 * `surveyWork` is **nullable** and that single change is most of why this version exists: a
 * project whose campaign closed last month, with five invitations still to deliver, must produce
 * a valid and operable pack. In v3 it could not — `campaign` was required — so the device was
 * told `no_active_campaign` and had nothing to do in a project where it had plenty.
 */
export const workPackSchema = z
  .object({
    schemaVersion: z.literal(FIELD_PACK_SCHEMA_VERSION_V4),
    protocolVersion: z.literal(FIELD_SYNC_PROTOCOL_VERSION_V4),
    technician: z
      .object({ userId: uuid, email: z.email(), name: z.string().max(200).nullable() })
      .strict(),
    project: packProjectSchema,
    surveyWork: packSurveyWorkSchema.nullable(),
    socializationWork: packSocializationWorkSchema,
    validity: packValiditySchema,
    cursor: z.string().min(1).max(200),
  })
  .strict();
export type WorkPack = z.infer<typeof workPackSchema>;

export const workPackResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pack"), pack: workPackSchema }).strict(),
  z
    .object({
      kind: z.literal("no_work"),
      /**
       * `no_work` now means *neither kind*. `no_active_campaign` is no longer a reason on its
       * own, because a project can have no campaign and plenty to do.
       */
      reason: z.enum(["no_work_assigned", "no_project_membership"]),
      message: z.string().min(1).max(400),
    })
    .strict(),
]);
export type WorkPackResponse = z.infer<typeof workPackResponseSchema>;

/* ---------------------------------------------------------------------------------------------
 * Pull
 * ------------------------------------------------------------------------------------------ */

export const workPullRequestSchema = z
  .object({
    tenantSlug: z.string().min(1).max(80),
    projectSlug: z.string().min(1).max(80),
    cursor: z.string().min(1).max(200).nullable(),
  })
  .strict();
export type WorkPullRequest = z.infer<typeof workPullRequestSchema>;

/**
 * What changed that this technician's device needs to know.
 *
 * A bounded **current set** of each kind, plus the ids that are no longer theirs. Not a change
 * feed: this is one person's work in one project, it is small, and a device that reconciles
 * against the current truth cannot drift the way one replaying a log can. Building CDC for a few
 * dozen rows would be a system to operate.
 *
 * `revokedInvitationIds` is what makes a reassignment visible to the device that lost it. The
 * application removes the row from its list and **keeps any local work against it**, marking it
 * for review — nothing here authorises deleting a technician's capture.
 */
/**
 * The survey half of a pull: what changed, not the questionnaire again.
 *
 * v3's pull deliberately carries `campaignStatus` and `surveyVersionId` rather than the campaign
 * object, because a questionnaire is large and unchanged between pulls — a device that already
 * downloaded it needs to know whether the version it holds is still the one being asked, which
 * is an id comparison. v4 keeps that and makes the whole thing nullable.
 */
export const pullSurveyChangesSchema = z
  .object({
    campaignStatus: z.enum(["DRAFT", "ACTIVE", "CLOSED"]),
    surveyVersionId: uuid,
    assignments: z.array(packAssignmentSchema),
  })
  .strict();
export type PullSurveyChanges = z.infer<typeof pullSurveyChangesSchema>;

export const workPullResponseSchema = z
  .object({
    protocolVersion: z.literal(FIELD_SYNC_PROTOCOL_VERSION_V4),
    surveyChanges: pullSurveyChangesSchema.nullable(),
    revokedAssignmentIds: z.array(uuid),
    socializationWork: packSocializationWorkSchema,
    revokedInvitationIds: z.array(uuid),
    validity: packValiditySchema,
    cursor: z.string().min(1).max(200),
  })
  .strict();
export type WorkPullResponse = z.infer<typeof workPullResponseSchema>;

/* ---------------------------------------------------------------------------------------------
 * The delivery command
 * ------------------------------------------------------------------------------------------ */

export const DELIVERY_OUTCOMES_WIRE = ["DELIVERED", "ABSENT", "REFUSED", "OTHER"] as const;
export const deliveryOutcomeWireSchema = z.enum(DELIVERY_OUTCOMES_WIRE);

/**
 * What happened at a gate.
 *
 * `invitationRevision` is read from the pack and sent back unchanged: the server compares it and
 * refuses rather than overwriting, which is how a delivery captured before a reassignment stops
 * being attributed to the wrong person.
 *
 * `localAttemptId` is minted when the technician saves and never regenerated. It is what makes a
 * retry one attempt rather than two, independently of `commandId` — a device that lost its
 * outbox but kept its records still cannot produce a second row.
 *
 * `storedObjectId` is required for `DELIVERED` by the domain, not by this schema: the refusal
 * belongs where it can say *why*, and a phone that posted without it should read a sentence
 * rather than a validation error.
 */
export const socializationDeliveryPayloadSchema = z
  .object({
    invitationId: uuid,
    invitationRevision: z.number().int().positive(),
    localAttemptId: uuid,
    outcome: deliveryOutcomeWireSchema,
    note: z.string().max(300).nullable(),
    location: wireLocationSchema.nullable(),
    storedObjectId: uuid.nullable(),
  })
  .strict();
export type SocializationDeliveryPayload = z.infer<typeof socializationDeliveryPayloadSchema>;

export const V4_COMMAND_TYPES = [
  "visit.start",
  "survey.upsert_draft",
  "survey.submit",
  "visit.finish",
  "media.declare",
  "socialization.delivery.record",
] as const;

const v4Envelope = {
  commandId: uuid,
  protocolVersion: z.literal(FIELD_SYNC_PROTOCOL_VERSION_V4),
  deviceRevision: z.number().int().nonnegative(),
  occurredAt: deviceInstant,
  appVersion: z.string().min(1).max(40),
  packSchemaVersion: z.number().int().positive(),
} as const;

/**
 * The one command v4 adds.
 *
 * The other five are unchanged in meaning, and the v4 sync route accepts them by rewriting the
 * envelope's version — see `apps/web/app/api/field/v4/sync/route.ts`. Restating their payloads
 * here would be five more definitions to keep in step with v3's for no benefit.
 */
export const socializationDeliveryCommandSchema = z
  .object({
    ...v4Envelope,
    type: z.literal("socialization.delivery.record"),
    payload: socializationDeliveryPayloadSchema,
  })
  .strict();
export type SocializationDeliveryCommand = z.infer<typeof socializationDeliveryCommandSchema>;

/** Why the server would not record a delivery. Mirrors the application's own vocabulary. */
export const DELIVERY_CONFLICT_REASONS_WIRE = [
  "invitation_reassigned",
  "invitation_revision_changed",
  "invitation_cancelled",
  "event_cancelled",
  "already_settled",
] as const;
export const deliveryConflictReasonSchema = z.enum(DELIVERY_CONFLICT_REASONS_WIRE);
export type DeliveryConflictReasonWire = z.infer<typeof deliveryConflictReasonSchema>;

/**
 * The result of one v4 command.
 *
 * A superset of v3's by two nullable fields, in a schema of its own, because adding them to v3's
 * `.strict()` object is exactly the change that breaks an older device's parse.
 */
export const v4CommandResultSchema = z
  .object({
    commandId: uuid,
    outcome: commandOutcomeSchema,
    visitId: uuid.nullable(),
    instanceId: uuid.nullable(),
    instanceStatus: z.enum(["IN_PROGRESS", "SUBMITTED"]).nullable(),
    assignmentStatus: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).nullable(),
    /** Set only by `socialization.delivery.record`. */
    attemptId: uuid.nullable(),
    invitationStatus: z.enum(["PENDING", "DELIVERED", "REFUSED", "CANCELLED"]).nullable(),
    conflictReason: z.string().max(60).nullable(),
    message: z.string().max(400).nullable(),
  })
  .strict();
export type V4CommandResult = z.infer<typeof v4CommandResultSchema>;

export const V4_SYNC_PUSH_LIMIT = 50;

export const v4SyncPushRequestSchema = z
  .object({
    tenantSlug: z.string().min(1).max(80),
    projectSlug: z.string().min(1).max(80),
    /**
     * Loosely typed on purpose at the envelope level: the five inherited commands are validated
     * by v3's own discriminated union after the version is rewritten, and the new one by its own
     * schema. One `z.unknown()` here beats a second copy of five payload definitions.
     */
    commands: z.array(z.unknown()).min(1).max(V4_SYNC_PUSH_LIMIT),
  })
  .strict();
export type V4SyncPushRequest = z.infer<typeof v4SyncPushRequestSchema>;

export const v4SyncPushResponseSchema = z
  .object({
    protocolVersion: z.literal(FIELD_SYNC_PROTOCOL_VERSION_V4),
    results: z.array(v4CommandResultSchema),
    cursor: z.string().min(1).max(200),
  })
  .strict();
export type V4SyncPushResponse = z.infer<typeof v4SyncPushResponseSchema>;

/* ---------------------------------------------------------------------------------------------
 * Evidence upload — the same three steps as field media, in its own namespace
 * ------------------------------------------------------------------------------------------ */

/**
 * The bytes do not travel on the command channel, for the reason ADR-032 gives about
 * photographs: intent, PUT straight to the provider, finalize, and only then the command.
 *
 * The namespace is `socialization-evidence` and the server chooses it; the device cannot name
 * one. A delivery photograph is private evidence — nothing re-encodes it, nothing strips its
 * EXIF, and no public route resolves its prefix.
 */
export const evidenceIntentRequestSchema = z
  .object({
    tenantSlug: z.string().min(1).max(80),
    projectSlug: z.string().min(1).max(80),
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(3).max(200),
    sizeBytes: z.number().int().positive(),
  })
  .strict();
export type EvidenceIntentRequest = z.infer<typeof evidenceIntentRequestSchema>;

export const evidenceIntentResponseSchema = z
  .object({
    intentId: uuid,
    url: z.string().min(1).max(4000),
    method: z.literal("PUT"),
    headers: z.record(z.string(), z.string()),
    objectKey: z.string().min(1).max(400),
    expiresAt: deviceInstant,
    maxBytes: z.number().int().positive(),
  })
  .strict();
export type EvidenceIntentResponse = z.infer<typeof evidenceIntentResponseSchema>;

export const evidenceFinalizeRequestSchema = z
  .object({
    tenantSlug: z.string().min(1).max(80),
    projectSlug: z.string().min(1).max(80),
    intentId: uuid,
    objectKey: z.string().min(1).max(400),
  })
  .strict();
export type EvidenceFinalizeRequest = z.infer<typeof evidenceFinalizeRequestSchema>;

export const evidenceFinalizeResponseSchema = z
  .object({ storedObjectId: uuid, sizeBytes: z.number().int().nonnegative() })
  .strict();
export type EvidenceFinalizeResponse = z.infer<typeof evidenceFinalizeResponseSchema>;

/* ---------------------------------------------------------------------------------------------
 * Local vocabulary — the device's own states for a delivery
 * ------------------------------------------------------------------------------------------ */

/**
 * What the phone believes about one delivery attempt.
 *
 * `REQUIRES_REVIEW` is the state the conflict path produces, and it is the reason the list is
 * not three items long: an attempt the server refused is **kept**, with its photograph, and a
 * person decides. Nothing in this application deletes a technician's capture.
 */
export const LOCAL_DELIVERY_STATES = [
  "SAVED",
  "EVIDENCE_PENDING",
  "READY_TO_SYNC",
  "SYNCING",
  "SYNCED",
  "SYNC_ERROR",
  "REQUIRES_REVIEW",
] as const;
export const localDeliveryStateSchema = z.enum(LOCAL_DELIVERY_STATES);
export type LocalDeliveryState = z.infer<typeof localDeliveryStateSchema>;
