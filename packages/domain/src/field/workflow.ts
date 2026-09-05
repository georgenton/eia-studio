import { z } from "zod";

import { InvalidInput } from "../core/errors";
import { assertCaptureChannelSatisfiesOfflineMode, type CaptureChannel } from "./capture-channel";
import { type FieldOfflineMode } from "./offline-mode";
import { type SurveyVersionStatus } from "./survey";

/**
 * The operational lifecycle of field work: campaign → assignment → visit → response.
 *
 * Four small state machines rather than one workflow engine. Each vocabulary is the smallest that
 * matches something the product actually does, and every transition rule here is also a database
 * constraint — these functions exist so a user gets a sentence, not so the rule lives only here.
 */

/* ---------------------------------------------------------------------------------------------
 * Campaign
 * ------------------------------------------------------------------------------------------ */

/**
 * A `SurveyCampaign` is the operational container that connects a project, a published survey
 * version, a set of assignments and their progress. It is what a coordinator opens and closes; it
 * is not a scheduler, and it holds no routing or optimisation of any kind.
 */
export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "CLOSED"] as const;
export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const CAMPAIGN_STATUS_LABEL: Readonly<Record<CampaignStatus, string>> = {
  DRAFT: "Borrador",
  ACTIVE: "En campo",
  CLOSED: "Cerrada",
};

export class CampaignNotActivatable extends InvalidInput {
  constructor(reason: string) {
    super(`this campaign cannot be activated: ${reason}`);
    this.name = "CampaignNotActivatable";
  }
}

/**
 * Everything that must hold before technicians can be sent out.
 *
 * The offline check is the one that closes D-020: a project whose policy requires offline capture
 * cannot activate a campaign on a channel that has no offline support, and the native web channel
 * has none. It fails here, at activation, rather than in a valley with no signal.
 */
export function assertCampaignActivatable(input: {
  readonly status: CampaignStatus;
  readonly surveyVersionStatus: SurveyVersionStatus;
  readonly assignmentCount: number;
  readonly captureChannel: CaptureChannel;
  readonly offlineMode: FieldOfflineMode;
}): void {
  if (input.status === "CLOSED") {
    throw new CampaignNotActivatable("it is closed; a closed campaign is not reopened");
  }
  if (input.surveyVersionStatus !== "PUBLISHED") {
    throw new CampaignNotActivatable(
      `its survey version is ${input.surveyVersionStatus}; answers may only be captured against a ` +
        "published version, because a draft can still change under them",
    );
  }
  if (input.assignmentCount < 1) {
    throw new CampaignNotActivatable(
      "it has no assignments, so nobody has been asked to do anything",
    );
  }
  // Throws OfflineCaptureUnsupported, which is the specific, actionable error.
  assertCaptureChannelSatisfiesOfflineMode(input.captureChannel, input.offlineMode);
}

export class CampaignNotClosable extends InvalidInput {
  constructor(reason: string) {
    super(`this campaign cannot be closed: ${reason}`);
    this.name = "CampaignNotClosable";
  }
}

/**
 * Closing is how a campaign stops being the current operation without losing what it did.
 *
 * It is the transition that makes the alternative unnecessary. When the parcels a campaign should
 * cover change after technicians have already been out, the honest move is to close what happened
 * and open what is now intended — never to rewrite yesterday's operation so today's plan matches
 * it (ADR-026). So closing deletes nothing, cancels nothing and touches no response: a closed
 * campaign keeps every assignment, visit and submitted answer it ever had.
 *
 * Only two states are refusable. A campaign that is already closed is a no-op the caller should
 * know about rather than repeat, and a `DRAFT` has nothing to close — it was never in the field,
 * so what it needs is to be activated or left alone.
 */
export function assertCampaignClosable(input: { readonly status: CampaignStatus }): void {
  if (input.status === "CLOSED") {
    throw new CampaignNotClosable("it is already closed");
  }
  if (input.status === "DRAFT") {
    throw new CampaignNotClosable(
      "it was never activated; a draft has no field work to close, and closing one would record " +
        "an operation that did not happen",
    );
  }
}

/* ---------------------------------------------------------------------------------------------
 * Assignment
 * ------------------------------------------------------------------------------------------ */

/**
 * A `FieldAssignment` is one technician being asked to survey one parcel for one campaign.
 *
 * It targets a **Parcel** directly. There is no polymorphic target table: this product surveys
 * parcels today, and a future project that surveys something else will add that target when it
 * exists, rather than paying for a join and a discriminator now to support a shape nobody has
 * described.
 *
 * The parcel is referenced by UUID. `parcel_code` stays the visible business identifier, and no
 * assignment is ever addressed by an owner's name.
 */
export const ASSIGNMENT_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const ASSIGNMENT_STATUS_PRESENTATION: Readonly<
  Record<AssignmentStatus, { label: string; glyph: string }>
> = {
  PENDING: { label: "Pendiente", glyph: "○" },
  IN_PROGRESS: { label: "En curso", glyph: "◐" },
  COMPLETED: { label: "Completada", glyph: "✓" },
  CANCELLED: { label: "Cancelada", glyph: "—" },
};

const ASSIGNMENT_TRANSITIONS: Readonly<Record<AssignmentStatus, ReadonlyArray<AssignmentStatus>>> =
  {
    PENDING: ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };

export class InvalidAssignmentTransition extends InvalidInput {
  constructor(from: AssignmentStatus, to: AssignmentStatus) {
    super(`an assignment cannot move from ${from} to ${to}`);
    this.name = "InvalidAssignmentTransition";
  }
}

export function canTransitionAssignment(from: AssignmentStatus, to: AssignmentStatus): boolean {
  return ASSIGNMENT_TRANSITIONS[from].includes(to);
}

export function assertAssignmentTransition(from: AssignmentStatus, to: AssignmentStatus): void {
  if (!canTransitionAssignment(from, to)) throw new InvalidAssignmentTransition(from, to);
}

/* ---------------------------------------------------------------------------------------------
 * Visit
 * ------------------------------------------------------------------------------------------ */

export const VISIT_STATUSES = ["IN_PROGRESS", "COMPLETED"] as const;
export const visitStatusSchema = z.enum(VISIT_STATUSES);
export type VisitStatus = z.infer<typeof visitStatusSchema>;

export const VISIT_STATUS_LABEL: Readonly<Record<VisitStatus, string>> = {
  IN_PROGRESS: "En curso",
  COMPLETED: "Completada",
};

/**
 * Geolocation captured by the browser, when the technician allows it.
 *
 * Two timestamps, on purpose. A visit's `started_at` and `completed_at` are **server** time,
 * because they are the workflow's record of when work happened and a device clock is not
 * authoritative. The location's own `capturedAt` is the browser's, because it describes when that
 * reading was taken — a different fact, which may legitimately differ from either.
 *
 * Coordinates are validated rather than trusted: a client can send anything.
 */
export const visitLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    /** Metres, as the Geolocation API reports it. Zero or negative would be meaningless. */
    accuracyM: z.number().positive().max(100_000).nullable(),
    capturedAt: z.date(),
  })
  .strict();
export type VisitLocation = z.infer<typeof visitLocationSchema>;

/** Why a visit has no location. Recorded truthfully; never fabricated. */
export const LOCATION_OUTCOMES = ["captured", "denied", "unavailable", "not_attempted"] as const;
export const locationOutcomeSchema = z.enum(LOCATION_OUTCOMES);
export type LocationOutcome = z.infer<typeof locationOutcomeSchema>;

export const LOCATION_OUTCOME_LABEL: Readonly<Record<LocationOutcome, string>> = {
  captured: "Ubicación capturada",
  denied: "Permiso de ubicación denegado",
  unavailable: "Ubicación no disponible en el dispositivo",
  not_attempted: "Ubicación no solicitada",
};

/* ---------------------------------------------------------------------------------------------
 * Survey instance
 * ------------------------------------------------------------------------------------------ */

/**
 * One response: a technician's answers to one survey version for one assignment.
 *
 * `IN_PROGRESS` is a draft the technician owns and may keep editing. `SUBMITTED` is final for
 * them: after it, the technician cannot silently change an answer, because a corrected answer that
 * looks like the original is the one thing a study cannot recover from.
 *
 * Correction is deliberately **not** implemented here. When it arrives it will be a reviewed
 * workflow that records who changed what and why — not a row edit, and not a status this slice
 * quietly leaves open.
 */
export const INSTANCE_STATUSES = ["IN_PROGRESS", "SUBMITTED"] as const;
export const instanceStatusSchema = z.enum(INSTANCE_STATUSES);
export type InstanceStatus = z.infer<typeof instanceStatusSchema>;

export const INSTANCE_STATUS_LABEL: Readonly<Record<InstanceStatus, string>> = {
  IN_PROGRESS: "Borrador",
  SUBMITTED: "Enviada",
};

export class InstanceAlreadySubmitted extends InvalidInput {
  constructor(readonly instanceId: string) {
    super(
      "this survey has already been submitted; a submitted response is not edited in place, so " +
        "that a correction can never be mistaken for the original answer",
    );
    this.name = "InstanceAlreadySubmitted";
  }
}

/** Guard for every mutation a technician can attempt on a response. */
export function assertInstanceEditable(status: InstanceStatus, instanceId: string): void {
  if (status === "SUBMITTED") throw new InstanceAlreadySubmitted(instanceId);
}

/* ---------------------------------------------------------------------------------------------
 * Progress
 * ------------------------------------------------------------------------------------------ */

export interface CampaignProgress {
  readonly total: number;
  readonly pending: number;
  readonly inProgress: number;
  readonly completed: number;
  readonly cancelled: number;
  /** Completed ÷ (total − cancelled), 0–1. Null when nothing is assignable. */
  readonly completionRatio: number | null;
}

/**
 * Progress is counted, not stored. A denormalised counter is a second truth that drifts the first
 * time a row is updated outside the one use-case that maintains it.
 */
export function campaignProgress(
  counts: Readonly<Record<AssignmentStatus, number>>,
): CampaignProgress {
  const total = ASSIGNMENT_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const assignable = total - counts.CANCELLED;
  return {
    total,
    pending: counts.PENDING,
    inProgress: counts.IN_PROGRESS,
    completed: counts.COMPLETED,
    cancelled: counts.CANCELLED,
    completionRatio: assignable > 0 ? counts.COMPLETED / assignable : null,
  };
}
