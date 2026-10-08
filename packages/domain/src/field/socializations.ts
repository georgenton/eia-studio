import { z } from "zod";

import { InvalidInput } from "../core/errors";

/**
 * Convening the people a road runs past, and recording that each one was told.
 *
 * A *socialización* is a meeting a consultancy holds about a study. This module models three
 * things and refuses to model a fourth:
 *
 * - an **event** — one convocation, with a time and a place;
 * - an **invitation** — one parcel is invited to one event, and somebody is responsible for
 *   delivering it;
 * - a **delivery attempt** — a technician went, and this is what happened.
 *
 * What is **not** here, deliberately: attendance. Who turned up is a different fact, collected at
 * the event by a different act, and a product that inferred attendance from a delivered
 * invitation would be asserting that somebody was there because a piece of paper reached their
 * gate. There is also no registration, no messaging, no route optimisation and no workflow
 * engine — the brief for this wave excludes each one, and each would be a product of its own.
 *
 * ## Why the invitation is the unit, and the attempt is not
 *
 * Three visits to the same parcel are one invitee, not three. Every count this product shows is
 * over invitations; attempts are the history of trying. The distinction is the difference between
 * "we invited 70 households" and "we knocked on doors 94 times", and only the first is a claim
 * about the convocation.
 *
 * ## Why an invitation names a parcel and not a person
 *
 * This product holds no model of people who are not its users. A parcel is the territorial unit
 * every other surface already works in, it is what the cartography gives, and it is what a
 * technician can find. `recipientLabel` exists for a name somebody wrote on a list by hand — it
 * is optional, it is never derived from a survey answer, and nothing requires it.
 */

/* ---------------------------------------------------------------------------------------------
 * The event
 * ------------------------------------------------------------------------------------------ */

export const SOCIALIZATION_EVENT_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "CANCELLED",
  "COMPLETED",
] as const;
export const socializationEventStatusSchema = z.enum(SOCIALIZATION_EVENT_STATUSES);
export type SocializationEventStatus = z.infer<typeof socializationEventStatusSchema>;

/** The glyph beside a status; the words are `vocabulary.socializationEventStatus.*`. */
export const SOCIALIZATION_EVENT_PRESENTATION: Readonly<
  Record<SocializationEventStatus, { glyph: string }>
> = {
  DRAFT: { glyph: "○" },
  SCHEDULED: { glyph: "◐" },
  CANCELLED: { glyph: "—" },
  COMPLETED: { glyph: "✓" },
};

const EVENT_TRANSITIONS: Readonly<
  Record<SocializationEventStatus, ReadonlyArray<SocializationEventStatus>>
> = {
  DRAFT: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["COMPLETED", "CANCELLED"],
  CANCELLED: [],
  COMPLETED: [],
};

export class InvalidEventTransition extends InvalidInput {
  constructor(from: SocializationEventStatus, to: SocializationEventStatus) {
    super(`a socialization event cannot move from ${from} to ${to}`);
    this.name = "InvalidEventTransition";
  }
}

export function assertEventTransition(
  from: SocializationEventStatus,
  to: SocializationEventStatus,
): void {
  if (!EVENT_TRANSITIONS[from].includes(to)) throw new InvalidEventTransition(from, to);
}

export class EventLogisticsFrozen extends InvalidInput {
  constructor() {
    super(
      "this event has invitations already, so its time, place and title cannot change: somebody " +
        "has been told them. A different convocation is a different event",
    );
    this.name = "EventLogisticsFrozen";
  }
}

/**
 * When the words on the invitation may still change.
 *
 * The moment the first invitation exists, the event's logistics are what somebody was told — on
 * paper, at a gate, by a technician who read it out. Editing the date afterwards would make the
 * record disagree with every invitation already delivered, and there is no mechanism in this
 * product (or in the world) to un-tell somebody a date.
 *
 * So it freezes, and the answer to a genuinely changed convocation is **another event**. That is
 * cheap — events are small and a project has many — and it keeps both convocations in the record,
 * which is what somebody reconstructing the consultation process needs.
 *
 * Deliberately not a versioning scheme. A general "version anything editable" mechanism is a
 * large thing to build for one table whose honest answer is "make a new one".
 */
export function assertEventLogisticsEditable(facts: {
  readonly status: SocializationEventStatus;
  readonly invitationCount: number;
}): void {
  if (facts.status === "CANCELLED" || facts.status === "COMPLETED") {
    throw new InvalidInput(`a ${facts.status.toLowerCase()} event is not edited`);
  }
  if (facts.invitationCount > 0) throw new EventLogisticsFrozen();
}

/* ---------------------------------------------------------------------------------------------
 * The invitation
 * ------------------------------------------------------------------------------------------ */

export const SOCIALIZATION_INVITATION_STATUSES = [
  "PENDING",
  "DELIVERED",
  "REFUSED",
  "CANCELLED",
] as const;
export const socializationInvitationStatusSchema = z.enum(SOCIALIZATION_INVITATION_STATUSES);
export type SocializationInvitationStatus = z.infer<typeof socializationInvitationStatusSchema>;

export const SOCIALIZATION_INVITATION_PRESENTATION: Readonly<
  Record<SocializationInvitationStatus, { glyph: string }>
> = {
  PENDING: { glyph: "○" },
  DELIVERED: { glyph: "✓" },
  REFUSED: { glyph: "✕" },
  CANCELLED: { glyph: "—" },
};

/** An invitation nobody will act on again. A terminal one takes no further ordinary attempt. */
export function isTerminalInvitationStatus(status: SocializationInvitationStatus): boolean {
  return status === "DELIVERED" || status === "REFUSED" || status === "CANCELLED";
}

/* ---------------------------------------------------------------------------------------------
 * The attempt
 * ------------------------------------------------------------------------------------------ */

/**
 * What happened when somebody went.
 *
 * Four outcomes, and the two that are not terminal are the reason there are four. `ABSENT` and
 * `OTHER` leave the invitation `PENDING`, because nobody was told anything and the work remains
 * to be done — a product that closed an invitation because one visit found nobody home would be
 * recording a convocation that did not happen.
 */
export const DELIVERY_OUTCOMES = ["DELIVERED", "ABSENT", "REFUSED", "OTHER"] as const;
export const deliveryOutcomeSchema = z.enum(DELIVERY_OUTCOMES);
export type DeliveryOutcome = z.infer<typeof deliveryOutcomeSchema>;

/** What an outcome does to the invitation it is an attempt at. */
export function invitationStatusAfter(
  outcome: DeliveryOutcome,
): SocializationInvitationStatus | null {
  switch (outcome) {
    case "DELIVERED":
      return "DELIVERED";
    case "REFUSED":
      return "REFUSED";
    // Nobody was told anything. The invitation stays open and somebody goes again.
    case "ABSENT":
    case "OTHER":
      return null;
  }
}

export class DeliveryNotRecordable extends InvalidInput {
  constructor(reason: string) {
    super(`this delivery cannot be recorded: ${reason}`);
    this.name = "DeliveryNotRecordable";
  }
}

/**
 * The rules an attempt must satisfy, in one place, so the mobile command and the desktop path
 * cannot disagree about them.
 *
 * **Evidence is required for `DELIVERED` and only for `DELIVERED`.** Saying a household was told
 * is the claim the whole record rests on, and a photograph of the delivery is the one thing that
 * makes it checkable afterwards. The other three outcomes record that nothing was delivered, so
 * there is nothing to evidence — demanding a photograph of an empty gate would teach people to
 * photograph empty gates.
 *
 * **A cancelled event takes no attempt.** The convocation is off; going anyway and recording it
 * would put a delivery against a meeting that will not happen.
 */
export function assertDeliveryRecordable(facts: {
  readonly invitationStatus: SocializationInvitationStatus;
  readonly eventStatus: SocializationEventStatus;
  readonly outcome: DeliveryOutcome;
  readonly hasEvidence: boolean;
}): void {
  if (facts.eventStatus === "CANCELLED") {
    throw new DeliveryNotRecordable("the event was cancelled");
  }
  if (isTerminalInvitationStatus(facts.invitationStatus)) {
    throw new DeliveryNotRecordable(
      `the invitation is already ${facts.invitationStatus.toLowerCase()}`,
    );
  }
  if (facts.outcome === "DELIVERED" && !facts.hasEvidence) {
    throw new DeliveryNotRecordable(
      "a delivered invitation needs a photograph; that evidence is what makes the record " +
        "checkable afterwards",
    );
  }
}

/* ---------------------------------------------------------------------------------------------
 * What a device is told, and what it is not
 * ------------------------------------------------------------------------------------------ */

/**
 * The free-text note a technician may add to an attempt.
 *
 * Bounded and optional. It is operational — *la casa estaba cerrada, dejé el aviso con el
 * vecino* — and it is **never** written to an audit line or a log, because somebody will
 * eventually write a name in it.
 */
export const deliveryNoteSchema = z.string().trim().min(1).max(300);

/** The label on an invitation, when a list had one. Never derived, never required. */
export const recipientLabelSchema = z.string().trim().min(1).max(160);

export const eventTitleSchema = z.string().trim().min(3).max(200);
export const eventLocationSchema = z.string().trim().min(3).max(300);
export const eventPurposeSchema = z.string().trim().min(3).max(1000);
