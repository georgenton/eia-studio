import {
  foreignKey,
  index,
  integer,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { app, project, projectMembership, provenanceRecord, user } from "./app";
import { pointColumn } from "./field";
import { parcel } from "./gis";
import { storedObject } from "./storage";

/**
 * Socializations: convening the people a road runs past, and recording that each was told.
 *
 * Three tables under FieldFlow, because the work is field work — a technician walks the corridor
 * with a stack of invitations exactly as they walk it with a questionnaire — and because every
 * control the field tables already carry is the control this needs: project scoping, the
 * row-ownership predicate of SECURITY.md §10b, and a device that holds only its own work.
 *
 * ## The unit of count is the invitation
 *
 * Three visits to one parcel are one invitee. `socialization_delivery_attempt` is the history of
 * trying; `socialization_invitation` is the thing that is counted. Every figure this product
 * shows about a convocation is over invitations, and the schema makes the other reading awkward
 * on purpose.
 *
 * ## What is absent
 *
 * No attendance, no registration, no person. An invitation names a **parcel** — the territorial
 * unit the cartography gives and a technician can find — and `recipient_label` is an optional
 * string somebody wrote on a list by hand. Nothing derives it from a survey answer, and no table
 * here can hold a response: the vocabulary has nowhere to put one.
 *
 * Vocabularies are duplicated from `@eia/domain` on purpose (db must not depend on domain); a
 * test asserts the two agree.
 */

export const socializationEventStatus = app.enum("socialization_event_status", [
  "DRAFT",
  "SCHEDULED",
  "CANCELLED",
  "COMPLETED",
]);

export const socializationInvitationStatus = app.enum("socialization_invitation_status", [
  "PENDING",
  "DELIVERED",
  "REFUSED",
  "CANCELLED",
]);

export const socializationDeliveryOutcome = app.enum("socialization_delivery_outcome", [
  "DELIVERED",
  "ABSENT",
  "REFUSED",
  "OTHER",
]);

/**
 * One convocation: a time, a place, and what it is about.
 *
 * A project has many, and they are independent — a second event is not a version of the first.
 * That is the answer to a changed date once invitations exist: the logistics freeze, and a
 * genuinely different convocation is a different row (see `assertEventLogisticsEditable`).
 *
 * `timezone` is stored beside `starts_at` rather than inferred. A `timestamptz` knows the
 * instant and not the zone it was meant in, and an invitation that prints *09:00* must print the
 * nine o'clock somebody wrote, in the zone the consultancy works in.
 */
export const socializationEvent = app.table(
  "socialization_event",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    title: text("title").notNull(),
    /** What the meeting is for, in the firm's own words. Printed on the invitation. */
    purpose: text("purpose"),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    /** IANA zone, e.g. `America/Guayaquil`. See the note above on why it is not derived. */
    timezone: text("timezone").notNull(),
    locationLabel: text("location_label").notNull(),
    status: socializationEventStatus("status").notNull().default("DRAFT"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    /** Why it was called off. Operational text; never printed on anything public. */
    cancelledReason: text("cancelled_reason"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("socialization_event_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "socialization_event_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "socialization_event_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    foreignKey({
      name: "socialization_event_created_by_fk",
      columns: [t.createdByUserId],
      foreignColumns: [user.id],
    }),
    index("socialization_event_project_idx").on(t.tenantId, t.projectId, t.startsAt),
  ],
);

/**
 * One parcel is invited to one event, and one person is responsible for telling them.
 *
 * `UNIQUE (tenant_id, event_id, parcel_id)` is the whole idempotence story: generating
 * invitations for a selection twice produces no second row, so a coordinator who clicks again
 * after a slow page has not doubled the convocation.
 *
 * ## Two columns about the surveyor, and why neither is the assignee
 *
 * `source_assignment_id` and `source_survey_technician_user_id` are a **snapshot** of who
 * surveyed this parcel, kept so the surface can offer that person as a suggestion — they know
 * the gate and the dog. They are history: the technician may since have left, and the column
 * must still say who it was. The person actually responsible is `assignee_membership_id`, which
 * somebody chose.
 *
 * `assignee_user_id` is denormalised from the membership so the row-level policy can compare it
 * without a recursive lookup — exactly as `field_assignment` does, and for the same reason.
 */
export const socializationInvitation = app.table(
  "socialization_invitation",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    eventId: uuid("event_id").notNull(),
    parcelId: uuid("parcel_id").notNull(),
    /** Historical: which survey assignment suggested this parcel. Never an authorization. */
    sourceAssignmentId: uuid("source_assignment_id"),
    /** Historical: who surveyed it. A snapshot, so it stays true after they leave. */
    sourceSurveyTechnicianUserId: uuid("source_survey_technician_user_id"),
    assigneeMembershipId: uuid("assignee_membership_id").notNull(),
    assigneeUserId: uuid("assignee_user_id").notNull(),
    /** A name from a list somebody kept. Optional, never derived, never required. */
    recipientLabel: text("recipient_label"),
    status: socializationInvitationStatus("status").notNull().default("PENDING"),
    /**
     * Rises on every change a device must notice: reassignment, cancellation, delivery.
     *
     * The phone reads it in the pack and sends it back with a delivery. A mismatch means the
     * world moved while the device was offline, and the answer is a conflict a person looks at —
     * never a silent re-attribution of somebody's walk to whoever holds the invitation now.
     */
    revision: integer("revision").notNull().default(1),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("socialization_invitation_tenant_id_id_key").on(t.tenantId, t.id),
    /** One invitation per parcel per event. Regenerating a selection adds nothing. */
    unique("socialization_invitation_event_parcel_key").on(t.tenantId, t.eventId, t.parcelId),
    foreignKey({
      name: "socialization_invitation_event_fk",
      columns: [t.tenantId, t.eventId],
      foreignColumns: [socializationEvent.tenantId, socializationEvent.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "socialization_invitation_parcel_fk",
      columns: [t.tenantId, t.parcelId],
      foreignColumns: [parcel.tenantId, parcel.id],
    }),
    foreignKey({
      name: "socialization_invitation_assignee_fk",
      columns: [t.tenantId, t.assigneeMembershipId],
      foreignColumns: [projectMembership.tenantId, projectMembership.id],
    }),
    foreignKey({
      name: "socialization_invitation_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "socialization_invitation_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    index("socialization_invitation_assignee_idx").on(t.tenantId, t.assigneeUserId, t.status),
    index("socialization_invitation_event_idx").on(t.tenantId, t.eventId, t.status),
  ],
);

/**
 * Somebody went. This is what happened.
 *
 * Append-only and written once, for the reason every evidence table in this product is: what a
 * technician reported at a gate, at a time, is a statement they made. A second visit is a second
 * row, which is why `ABSENT` leaves the invitation open.
 *
 * `UNIQUE (tenant_id, invitation_id, local_id)` is the zero-duplicate guarantee, independent of
 * the sync envelope's `commandId`: the id is minted on the device when the technician saves, so a
 * phone that lost its outbox but kept its records still cannot produce a second attempt.
 *
 * `occurred_at_device` and `received_at_server` are two different facts and are stored as two
 * columns. A device clock is what the technician's phone believed; it is never promoted to the
 * workflow's own timestamp.
 */
export const socializationDeliveryAttempt = app.table(
  "socialization_delivery_attempt",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    invitationId: uuid("invitation_id").notNull(),
    /** Minted on the device at the moment of saving, and never regenerated. */
    localId: uuid("local_id").notNull(),
    /** From the session. The device never sends a user id and the server never reads one. */
    technicianUserId: uuid("technician_user_id").notNull(),
    outcome: socializationDeliveryOutcome("outcome").notNull(),
    occurredAtDevice: timestamp("occurred_at_device", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    receivedAtServer: timestamp("received_at_server", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** Operational text. Never written to an audit line or a log: somebody will put a name in it. */
    note: text("note"),
    location: pointColumn("location"),
    locationAccuracyM: numeric("location_accuracy_m", { precision: 10, scale: 1 }),
    /** Required by the domain rule for `DELIVERED`, and private: see ADR-041. */
    evidenceStoredObjectId: uuid("evidence_stored_object_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("socialization_delivery_attempt_tenant_id_id_key").on(t.tenantId, t.id),
    unique("socialization_delivery_attempt_local_key").on(t.tenantId, t.invitationId, t.localId),
    foreignKey({
      name: "socialization_delivery_attempt_invitation_fk",
      columns: [t.tenantId, t.invitationId],
      foreignColumns: [socializationInvitation.tenantId, socializationInvitation.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "socialization_delivery_attempt_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "socialization_delivery_attempt_evidence_fk",
      columns: [t.tenantId, t.evidenceStoredObjectId],
      foreignColumns: [storedObject.tenantId, storedObject.id],
    }),
    foreignKey({
      name: "socialization_delivery_attempt_technician_fk",
      columns: [t.technicianUserId],
      foreignColumns: [user.id],
    }),
    index("socialization_delivery_attempt_invitation_idx").on(t.tenantId, t.invitationId),
  ],
);
