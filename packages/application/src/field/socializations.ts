import { randomUUID } from "node:crypto";

import { appSchema, socializationSchema, type Database, type DbTx } from "@eia/db";
import {
  assertDeliveryRecordable,
  assertEventLogisticsEditable,
  assertEventTransition,
  deliveryNoteSchema,
  deliveryOutcomeSchema,
  eventLocationSchema,
  eventPurposeSchema,
  eventTitleSchema,
  invitationStatusAfter,
  InvalidInput,
  NotFound,
  recipientLabelSchema,
  requireCapability,
  requirePermission,
  type DeliveryOutcome,
  type RequestContext,
  type SocializationEventStatus,
  type SocializationInvitationStatus,
} from "@eia/domain";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../audit/record";
import { withFieldContext } from "./context";

/**
 * Convening the people a road runs past (ADR-041).
 *
 * Everything here lives under the `field.surveys` capability and behind
 * `field.socializations.manage`, except the two acts that are somebody else's: **who delivers an
 * invitation** is `field.assignments.manage`, the same key that decides who surveys a parcel,
 * and **recording a delivery** is `field.capture` by the technician the invitation belongs to.
 *
 * ## No capability of its own
 *
 * A socialization is field work. Giving it a fifteenth capability key would split one question —
 * *does this project do field work?* — across two switches that can disagree, which is the
 * mistake ADR-035 §8 avoided for `quality.rag_assistant`. The catalogue still holds 14 keys.
 */

/* ---------------------------------------------------------------------------------------------
 * the event
 * ------------------------------------------------------------------------------------------ */

export const createEventInputSchema = z
  .object({
    title: eventTitleSchema,
    purpose: eventPurposeSchema.nullable().default(null),
    startsAt: z.coerce.date(),
    /** IANA zone. Stored beside the instant, because an invitation prints the hour as written. */
    timezone: z.string().trim().min(3).max(60),
    locationLabel: eventLocationSchema,
  })
  .strict();
export type CreateEventInput = z.infer<typeof createEventInputSchema>;

export async function createSocializationEvent(
  db: Database,
  ctx: RequestContext,
  raw: CreateEventInput,
): Promise<{ eventId: string }> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.socializations.manage");
  const projectId = requireProject(ctx);
  const input = createEventInputSchema.parse(raw);

  return withFieldContext(db, ctx, async (tx) => {
    const provenanceId = await insertEventProvenance(tx, ctx, projectId);
    const eventId = randomUUID();
    await tx.insert(socializationSchema.socializationEvent).values({
      id: eventId,
      tenantId: ctx.tenantId,
      projectId,
      title: input.title,
      purpose: input.purpose,
      startsAt: input.startsAt,
      timezone: input.timezone,
      locationLabel: input.locationLabel,
      status: "DRAFT",
      createdByUserId: ctx.userId,
      provenanceId,
    });

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.socialization.event_created",
        objectKind: "socialization_event",
        objectId: eventId,
        details: { startsAt: input.startsAt.toISOString(), timezone: input.timezone },
      },
    );
    return { eventId };
  });
}

export const updateEventInputSchema = createEventInputSchema.extend({ eventId: z.uuid() }).strict();
export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;

/**
 * Edit the convocation — while it is still only a plan.
 *
 * `assertEventLogisticsEditable` refuses once an invitation exists, and the trigger in migration
 * 0057 refuses again underneath. Two layers for one rule because this one protects a statement
 * already made to somebody outside this product: a piece of paper that was carried to a gate.
 */
export async function updateSocializationEvent(
  db: Database,
  ctx: RequestContext,
  raw: UpdateEventInput,
): Promise<void> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.socializations.manage");
  const projectId = requireProject(ctx);
  const input = updateEventInputSchema.parse(raw);

  await withFieldContext(db, ctx, async (tx) => {
    const event = await readEvent(tx, ctx, projectId, input.eventId);
    assertEventLogisticsEditable({
      status: event.status,
      invitationCount: event.invitationCount,
    });

    await tx
      .update(socializationSchema.socializationEvent)
      .set({
        title: input.title,
        purpose: input.purpose,
        startsAt: input.startsAt,
        timezone: input.timezone,
        locationLabel: input.locationLabel,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(socializationSchema.socializationEvent.tenantId, ctx.tenantId),
          eq(socializationSchema.socializationEvent.id, input.eventId),
        ),
      );
  });
}

export const eventTransitionInputSchema = z
  .object({
    eventId: z.uuid(),
    to: z.enum(["SCHEDULED", "CANCELLED", "COMPLETED"]),
    reason: z.string().trim().min(8).max(400).nullable().default(null),
  })
  .strict();
export type EventTransitionInput = z.infer<typeof eventTransitionInputSchema>;

/**
 * Move an event along, and — when it is cancelled — stop the work that was for it.
 *
 * Cancelling keeps every delivery already recorded: somebody was told, and that happened. What
 * it does is cancel the invitations nobody has acted on, so a technician whose device still
 * holds one is told rather than left walking to a meeting that is off. `DELIVERED` and `REFUSED`
 * invitations are untouched — they are history, not pending work.
 */
export async function transitionSocializationEvent(
  db: Database,
  ctx: RequestContext,
  raw: EventTransitionInput,
): Promise<{ cancelledInvitations: number }> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.socializations.manage");
  const projectId = requireProject(ctx);
  const input = eventTransitionInputSchema.parse(raw);

  return withFieldContext(db, ctx, async (tx) => {
    const event = await readEvent(tx, ctx, projectId, input.eventId);
    assertEventTransition(event.status, input.to);
    if (input.to === "CANCELLED" && input.reason === null) {
      throw new InvalidInput("say why the event was called off; it is recorded");
    }

    await tx
      .update(socializationSchema.socializationEvent)
      .set({
        status: input.to,
        updatedAt: new Date(),
        ...(input.to === "CANCELLED"
          ? { cancelledAt: new Date(), cancelledReason: input.reason }
          : {}),
      })
      .where(
        and(
          eq(socializationSchema.socializationEvent.tenantId, ctx.tenantId),
          eq(socializationSchema.socializationEvent.id, input.eventId),
        ),
      );

    let cancelledInvitations = 0;
    if (input.to === "CANCELLED") {
      const cancelled = await tx.execute<{ id: string }>(sql`
        update app.socialization_invitation
           set status = 'CANCELLED', cancelled_at = now(), revision = revision + 1
         where tenant_id = ${ctx.tenantId} and event_id = ${input.eventId} and status = 'PENDING'
        returning id
      `);
      cancelledInvitations = cancelled.rows.length;
    }

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action:
          input.to === "CANCELLED"
            ? "field.socialization.event_cancelled"
            : "field.socialization.event_scheduled",
        objectKind: "socialization_event",
        objectId: input.eventId,
        details: { to: input.to, cancelledInvitations },
      },
    );
    return { cancelledInvitations };
  });
}

/* ---------------------------------------------------------------------------------------------
 * invitations
 * ------------------------------------------------------------------------------------------ */

export interface InvitationCandidate {
  readonly parcelId: string;
  readonly parcelCode: string;
  readonly sectorLabel: string | null;
  /** True when this parcel already has an invitation to this event. */
  readonly alreadyInvited: boolean;
  /** Whether a response was captured here, which is what makes it a likely invitee. */
  readonly surveyed: boolean;
  /** Who surveyed it, offered as a suggestion and **not** saved until somebody confirms. */
  readonly suggestedMembershipId: string | null;
  readonly suggestedName: string | null;
  readonly sourceAssignmentId: string | null;
  readonly sourceTechnicianUserId: string | null;
}

/**
 * The parcels somebody might invite, with the technician who surveyed each one beside it.
 *
 * The suggestion is the whole value of this read model: the person who already walked to that
 * gate knows where it is, and offering them costs nothing. It is offered and never applied —
 * nothing is written until a person confirms, because a product that quietly assigned a day's
 * walking to whoever happened to survey the parcel last month is deciding somebody's week.
 *
 * A suggestion is withheld when that technician is no longer an active `FIELD_TECHNICIAN` here;
 * the parcel is still a candidate, with nobody suggested.
 *
 * **No answer is read.** The query asks whether a response exists, never what it said.
 */
export async function listInvitationCandidates(
  db: Database,
  ctx: RequestContext,
  eventId: string,
): Promise<ReadonlyArray<InvitationCandidate>> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.socializations.manage");
  const projectId = requireProject(ctx);

  return withFieldContext(db, ctx, async (tx) => {
    await readEvent(tx, ctx, projectId, eventId);
    const rows = await tx.execute<{
      parcel_id: string;
      parcel_code: string;
      sector_label: string | null;
      already_invited: boolean;
      surveyed: boolean;
      suggested_membership_id: string | null;
      suggested_name: string | null;
      source_assignment_id: string | null;
      source_technician_user_id: string | null;
    }>(sql`
      with surveyed as (
        select distinct on (fa.parcel_id)
               fa.parcel_id,
               fa.id                     as assignment_id,
               fa.assignee_membership_id as membership_id,
               fa.assignee_user_id       as user_id
          from app.field_assignment fa
          join app.survey_instance si
            on si.tenant_id = fa.tenant_id and si.assignment_id = fa.id
         where fa.tenant_id = ${ctx.tenantId} and fa.project_id = ${projectId}
           and si.status = 'SUBMITTED'
         order by fa.parcel_id, si.submitted_at desc nulls last
      )
      select p.id                                   as parcel_id,
             p.parcel_code                          as parcel_code,
             p.sector_label                         as sector_label,
             (inv.id is not null)                   as already_invited,
             (s.parcel_id is not null)              as surveyed,
             -- Suggested only while they are still an active technician on this project.
             case when pm.id is not null then s.membership_id end as suggested_membership_id,
             case when pm.id is not null then coalesce(u.name, u.email) end as suggested_name,
             s.assignment_id                        as source_assignment_id,
             s.user_id                              as source_technician_user_id
        from app.parcel p
        left join surveyed s on s.parcel_id = p.id
        left join app.project_membership pm
          on pm.tenant_id = ${ctx.tenantId} and pm.id = s.membership_id
         and pm.status = 'active' and pm.role = 'FIELD_TECHNICIAN'
        left join app.tenant_membership tm
          on tm.tenant_id = pm.tenant_id and tm.id = pm.tenant_membership_id
        left join app."user" u on u.id = tm.user_id
        left join app.socialization_invitation inv
          on inv.tenant_id = p.tenant_id and inv.parcel_id = p.id and inv.event_id = ${eventId}
       where p.tenant_id = ${ctx.tenantId} and p.project_id = ${projectId}
       order by p.parcel_code
    `);

    return rows.rows.map((row) => ({
      parcelId: row.parcel_id,
      parcelCode: row.parcel_code,
      sectorLabel: row.sector_label,
      alreadyInvited: row.already_invited === true,
      surveyed: row.surveyed === true,
      suggestedMembershipId: row.suggested_membership_id,
      suggestedName: row.suggested_name,
      sourceAssignmentId: row.source_assignment_id,
      sourceTechnicianUserId: row.source_technician_user_id,
    }));
  });
}

export const generateInvitationsInputSchema = z
  .object({
    eventId: z.uuid(),
    parcels: z
      .array(
        z
          .object({
            parcelId: z.uuid(),
            /** Confirmed by a person. The suggestion is a suggestion until this arrives. */
            assigneeMembershipId: z.uuid(),
            recipientLabel: recipientLabelSchema.nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type GenerateInvitationsInput = z.infer<typeof generateInvitationsInputSchema>;

/**
 * Invite a selection of parcels, once.
 *
 * Idempotent by `UNIQUE (tenant_id, event_id, parcel_id)` and `ON CONFLICT DO NOTHING`: running
 * it again over a selection that overlaps adds nothing and is not an error. A coordinator who
 * clicked twice on a slow page has not doubled the convocation, and the count returned says what
 * actually happened.
 *
 * Assigning is a second permission (`field.assignments.manage`) because it is the same decision
 * about the same people's days that survey assignment is. A specialist holds both by role; the
 * key says it is two acts.
 */
export async function generateInvitations(
  db: Database,
  ctx: RequestContext,
  raw: GenerateInvitationsInput,
): Promise<{ created: number; skipped: number }> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.socializations.manage");
  requirePermission(ctx, "field.assignments.manage");
  const projectId = requireProject(ctx);
  const input = generateInvitationsInputSchema.parse(raw);

  return withFieldContext(db, ctx, async (tx) => {
    const event = await readEvent(tx, ctx, projectId, input.eventId);
    if (event.status === "CANCELLED" || event.status === "COMPLETED") {
      throw new InvalidInput(`a ${event.status.toLowerCase()} event takes no new invitations`);
    }

    // Which parcel was surveyed by whom, so the snapshot columns are filled from the record
    // rather than from whatever the browser sent.
    const sources = await tx.execute<{
      parcel_id: string;
      assignment_id: string;
      user_id: string;
    }>(sql`
      select distinct on (fa.parcel_id)
             fa.parcel_id, fa.id as assignment_id, fa.assignee_user_id as user_id
        from app.field_assignment fa
        join app.survey_instance si
          on si.tenant_id = fa.tenant_id and si.assignment_id = fa.id
       where fa.tenant_id = ${ctx.tenantId} and fa.project_id = ${projectId}
         and si.status = 'SUBMITTED'
       order by fa.parcel_id, si.submitted_at desc nulls last
    `);
    const sourceByParcel = new Map(sources.rows.map((r) => [r.parcel_id, r]));

    let created = 0;
    for (const entry of input.parcels) {
      await assertParcelBelongsHere(tx, ctx, projectId, entry.parcelId);
      const assignee = await readTechnician(tx, ctx, projectId, entry.assigneeMembershipId);
      const source = sourceByParcel.get(entry.parcelId) ?? null;
      const provenanceId = await insertInvitationProvenance(tx, ctx, projectId);

      const inserted = await tx
        .insert(socializationSchema.socializationInvitation)
        .values({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          projectId,
          eventId: input.eventId,
          parcelId: entry.parcelId,
          sourceAssignmentId: source?.assignment_id ?? null,
          sourceSurveyTechnicianUserId: source?.user_id ?? null,
          assigneeMembershipId: assignee.membershipId,
          assigneeUserId: assignee.userId,
          recipientLabel: entry.recipientLabel,
          status: "PENDING",
          provenanceId,
        })
        .onConflictDoNothing({
          target: [
            socializationSchema.socializationInvitation.tenantId,
            socializationSchema.socializationInvitation.eventId,
            socializationSchema.socializationInvitation.parcelId,
          ],
        })
        .returning({ id: socializationSchema.socializationInvitation.id });
      if (inserted[0]) created += 1;
    }

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.socialization.invitations_generated",
        objectKind: "socialization_event",
        objectId: input.eventId,
        // A count, never the parcels. Which households a convocation reached is a question for
        // the surface, under RLS, not for a log line.
        details: { requested: input.parcels.length, created },
      },
    );
    return { created, skipped: input.parcels.length - created };
  });
}

export const reassignInvitationInputSchema = z
  .object({ invitationId: z.uuid(), assigneeMembershipId: z.uuid() })
  .strict();
export type ReassignInvitationInput = z.infer<typeof reassignInvitationInputSchema>;

/**
 * Hand a pending invitation to somebody else.
 *
 * Only `PENDING`: a delivered or refused invitation is a thing that happened, and reassigning it
 * would attribute somebody's walk to a person who did not take it. `revision` rises, which is
 * what makes a device holding the old one find out — see `socialization.delivery.record`.
 */
export async function reassignInvitation(
  db: Database,
  ctx: RequestContext,
  raw: ReassignInvitationInput,
): Promise<void> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.socializations.manage");
  requirePermission(ctx, "field.assignments.manage");
  const projectId = requireProject(ctx);
  const input = reassignInvitationInputSchema.parse(raw);

  await withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute<{ status: SocializationInvitationStatus; assignee: string }>(sql`
      select status::text as status, assignee_membership_id as assignee
        from app.socialization_invitation
       where tenant_id = ${ctx.tenantId} and project_id = ${projectId} and id = ${input.invitationId}
       limit 1
    `);
    const current = rows.rows[0];
    if (!current) throw new NotFound("socialization invitation");
    if (current.status !== "PENDING") {
      throw new InvalidInput(
        `this invitation is ${current.status.toLowerCase()}; only a pending one changes hands`,
      );
    }
    const assignee = await readTechnician(tx, ctx, projectId, input.assigneeMembershipId);

    await tx.execute(sql`
      update app.socialization_invitation
         set assignee_membership_id = ${assignee.membershipId},
             assignee_user_id = ${assignee.userId},
             assigned_at = now(),
             revision = revision + 1
       where tenant_id = ${ctx.tenantId} and id = ${input.invitationId}
    `);

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.socialization.invitation_reassigned",
        objectKind: "socialization_invitation",
        objectId: input.invitationId,
        details: { fromMembershipId: current.assignee, toMembershipId: assignee.membershipId },
      },
    );
  });
}

/* ---------------------------------------------------------------------------------------------
 * recording a delivery
 * ------------------------------------------------------------------------------------------ */

export const recordDeliveryInputSchema = z
  .object({
    invitationId: z.uuid(),
    /** What the device read from its pack. A mismatch is a conflict, never a silent overwrite. */
    invitationRevision: z.number().int().positive(),
    /** Minted on the device when the technician saved, and never regenerated. */
    localAttemptId: z.uuid(),
    outcome: deliveryOutcomeSchema,
    occurredAt: z.coerce.date(),
    note: deliveryNoteSchema.nullable().default(null),
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracyM: z.number().positive().max(100_000).nullable(),
      })
      .strict()
      .nullable()
      .default(null),
    /** Required for `DELIVERED`, by the domain rule. Must be this caller's own upload. */
    evidenceStoredObjectId: z.uuid().nullable().default(null),
  })
  .strict();
export type RecordDeliveryInput = z.infer<typeof recordDeliveryInputSchema>;

export type RecordDeliveryResult =
  | { readonly kind: "recorded"; readonly attemptId: string; readonly duplicate: boolean }
  | {
      readonly kind: "conflict";
      readonly reason: DeliveryConflictReason;
      readonly message: string;
    };

export const DELIVERY_CONFLICT_REASONS = [
  "invitation_reassigned",
  "invitation_revision_changed",
  "invitation_cancelled",
  "event_cancelled",
  "already_settled",
] as const;
export type DeliveryConflictReason = (typeof DELIVERY_CONFLICT_REASONS)[number];

/**
 * A technician went to a gate. This records what happened, once.
 *
 * ## Why it returns a conflict instead of throwing
 *
 * The caller is usually a phone replaying something captured hours ago in a valley. Between the
 * capture and the sync an invitation may have been reassigned, the event cancelled, or somebody
 * else may have delivered it. None of those is the technician's mistake and none of them should
 * lose their work: the server says *conflict*, the device keeps the attempt and the photograph
 * and marks it **requires review**. Throwing would make the outbox retry something that can
 * never succeed.
 *
 * Reassignment is the case that matters most. A delivery recorded against an invitation that now
 * belongs to somebody else would attribute one person's walk to another; so the check is
 * `assignee_user_id = caller` **and** the revision the device read, and both are compared here
 * rather than trusted from the payload.
 *
 * ## Idempotence
 *
 * `UNIQUE (tenant_id, invitation_id, local_id)`. A retry is answered with the row it already
 * wrote, and `duplicate` says so, independently of the sync envelope's `commandId`.
 */
export async function recordDeliveryAttempt(
  db: Database,
  ctx: RequestContext,
  raw: RecordDeliveryInput,
): Promise<RecordDeliveryResult> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.capture");
  const projectId = requireProject(ctx);
  const input = recordDeliveryInputSchema.parse(raw);

  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      status: SocializationInvitationStatus;
      revision: number;
      assignee_user_id: string;
      event_status: SocializationEventStatus;
    }>(sql`
      select i.id,
             i.status::text      as status,
             i.revision          as revision,
             i.assignee_user_id  as assignee_user_id,
             e.status::text      as event_status
        from app.socialization_invitation i
        join app.socialization_event e on e.tenant_id = i.tenant_id and e.id = i.event_id
       where i.tenant_id = ${ctx.tenantId} and i.project_id = ${projectId}
         and i.id = ${input.invitationId}
       limit 1
    `);
    const invitation = rows.rows[0];
    if (!invitation) {
      /*
       * The row-level policy hides an invitation that is no longer this technician's — which is
       * exactly the case this command exists to handle well. A delivery captured in a valley and
       * synced hours later must come back as a **conflict**, so the device keeps the attempt and
       * the photograph and a person looks; "not found" would be indistinguishable from a
       * malformed command.
       *
       * `app.socialization_delivery_conflict` answers that one question from outside RLS and
       * returns a reason code and nothing else (migration 0057 §7).
       */
      const probe = await tx.execute<{ reason: string | null }>(sql`
        select app.socialization_delivery_conflict(
          ${ctx.tenantId}::uuid, ${projectId}::uuid, ${input.invitationId}::uuid
        )::text as reason
      `);
      const reason = probe.rows[0]?.reason ?? "not_found";
      if (reason === "not_found" || reason === "none")
        throw new NotFound("socialization invitation");
      return conflict(reason as DeliveryConflictReason, conflictMessage(reason));
    }

    // An attempt this device already sent. Answered rather than refused, and before any of the
    // conflict checks: a retry of something that succeeded must not become a conflict because
    // the invitation is now DELIVERED — by this very row.
    const existing = await tx.execute<{ id: string }>(sql`
      select id from app.socialization_delivery_attempt
       where tenant_id = ${ctx.tenantId} and invitation_id = ${input.invitationId}
         and local_id = ${input.localAttemptId}
       limit 1
    `);
    if (existing.rows[0]) {
      return { kind: "recorded", attemptId: existing.rows[0].id, duplicate: true };
    }

    if (invitation.assignee_user_id !== ctx.userId) {
      return conflict("invitation_reassigned", "esta invitación ya no está a tu nombre");
    }
    if (invitation.revision !== input.invitationRevision) {
      return conflict(
        "invitation_revision_changed",
        "la invitación cambió en el servidor después de que la descargaste",
      );
    }
    if (invitation.event_status === "CANCELLED") {
      return conflict("event_cancelled", "la socialización fue cancelada");
    }
    if (invitation.status === "CANCELLED") {
      return conflict("invitation_cancelled", "esta invitación fue cancelada");
    }
    if (invitation.status === "DELIVERED" || invitation.status === "REFUSED") {
      return conflict("already_settled", "esta invitación ya tiene un resultado registrado");
    }

    if (input.evidenceStoredObjectId !== null) {
      await assertEvidenceUsable(tx, ctx, projectId, input.evidenceStoredObjectId);
    }

    // The rule, in the domain, where it produces a sentence: a delivered invitation needs a
    // photograph, and a cancelled event takes no attempt at all.
    assertDeliveryRecordable({
      invitationStatus: invitation.status,
      eventStatus: invitation.event_status,
      outcome: input.outcome,
      hasEvidence: input.evidenceStoredObjectId !== null,
    });

    const attemptId = randomUUID();
    await tx.execute(sql`
      insert into app.socialization_delivery_attempt
        (id, tenant_id, project_id, invitation_id, local_id, technician_user_id, outcome,
         occurred_at_device, note, location, location_accuracy_m, evidence_stored_object_id)
      values (${attemptId}, ${ctx.tenantId}, ${projectId}, ${input.invitationId},
              ${input.localAttemptId}, ${ctx.userId}, ${input.outcome}::app.socialization_delivery_outcome,
              ${input.occurredAt.toISOString()},
              ${input.note},
              ${
                input.location === null
                  ? null
                  : sql`ST_SetSRID(ST_MakePoint(${input.location.longitude}, ${input.location.latitude}), 4326)`
              },
              ${input.location?.accuracyM ?? null},
              ${input.evidenceStoredObjectId})
    `);

    const next = invitationStatusAfter(input.outcome);
    if (next !== null) {
      await tx.execute(sql`
        update app.socialization_invitation
           set status = ${next}::app.socialization_invitation_status,
               revision = revision + 1,
               delivered_at = case when ${next} = 'DELIVERED' then now() else delivered_at end
         where tenant_id = ${ctx.tenantId} and id = ${input.invitationId}
      `);
    }

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.socialization.delivery_recorded",
        objectKind: "socialization_delivery_attempt",
        objectId: attemptId,
        /*
         * The outcome and whether evidence exists. Never the note, never the coordinates, never
         * the recipient's label: an audit line is read by more people than the surface it
         * describes, and each of those three can name a person or a house.
         */
        details: {
          invitationId: input.invitationId,
          outcome: input.outcome,
          hasEvidence: input.evidenceStoredObjectId !== null,
        },
      },
    );

    return { kind: "recorded", attemptId, duplicate: false };
  });
}

function conflict(reason: DeliveryConflictReason, message: string): RecordDeliveryResult {
  return { kind: "conflict", reason, message };
}

/**
 * What the technician reads on the phone. Spanish, because this reaches a screen in the field —
 * and bounded to the reason, because naming who the invitation went to would tell one technician
 * about another's day.
 */
function conflictMessage(reason: string): string {
  switch (reason) {
    case "invitation_reassigned":
      return "esta invitación ya no está a tu nombre";
    case "invitation_cancelled":
      return "esta invitación fue cancelada";
    case "event_cancelled":
      return "la socialización fue cancelada";
    case "already_settled":
      return "esta invitación ya tiene un resultado registrado";
    default:
      return "esta invitación cambió en el servidor";
  }
}

/* ---------------------------------------------------------------------------------------------
 * helpers
 * ------------------------------------------------------------------------------------------ */

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new InvalidInput("this action needs a project in context");
  return ctx.projectId;
}

async function readEvent(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  eventId: string,
): Promise<{ status: SocializationEventStatus; invitationCount: number }> {
  const rows = await tx.execute<{ status: SocializationEventStatus; invitations: number }>(sql`
    select e.status::text as status,
           (select count(*) from app.socialization_invitation i
             where i.tenant_id = e.tenant_id and i.event_id = e.id)::int as invitations
      from app.socialization_event e
     where e.tenant_id = ${ctx.tenantId} and e.project_id = ${projectId} and e.id = ${eventId}
     limit 1
  `);
  const row = rows.rows[0];
  if (!row) throw new NotFound("socialization event");
  return { status: row.status, invitationCount: Number(row.invitations) };
}

async function assertParcelBelongsHere(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  parcelId: string,
): Promise<void> {
  const rows = await tx.execute<{ id: string }>(sql`
    select id from app.parcel
     where tenant_id = ${ctx.tenantId} and project_id = ${projectId} and id = ${parcelId} limit 1
  `);
  if (!rows.rows[0]) throw new NotFound("parcel");
}

async function readTechnician(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  membershipId: string,
): Promise<{ membershipId: string; userId: string }> {
  const rows = await tx.execute<{ id: string; user_id: string }>(sql`
    select pm.id, tm.user_id
      from app.project_membership pm
      join app.tenant_membership tm
        on tm.tenant_id = pm.tenant_id and tm.id = pm.tenant_membership_id
     where pm.tenant_id = ${ctx.tenantId} and pm.project_id = ${projectId}
       and pm.id = ${membershipId} and pm.status = 'active' and pm.role = 'FIELD_TECHNICIAN'
     limit 1
  `);
  const row = rows.rows[0];
  if (!row) throw new NotFound("field technician membership");
  return { membershipId: row.id, userId: row.user_id };
}

/**
 * The photograph must be this project's, in the evidence namespace, uploaded by this caller.
 *
 * Three checks and not one: a stored object id from another namespace would let a delivery point
 * at a published editorial photograph or at a delivered study; one uploaded by somebody else
 * would let a technician file another person's picture as their own evidence.
 */
async function assertEvidenceUsable(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  storedObjectId: string,
): Promise<void> {
  const rows = await tx.execute<{ namespace: string; uploaded_by: string }>(sql`
    select namespace::text as namespace, uploaded_by_user_id as uploaded_by
      from app.stored_object
     where tenant_id = ${ctx.tenantId} and project_id = ${projectId} and id = ${storedObjectId}
     limit 1
  `);
  const row = rows.rows[0];
  if (!row) throw new NotFound("stored object");
  if (row.namespace !== "socialization-evidence") {
    throw new InvalidInput("this file is not socialization evidence");
  }
  if (row.uploaded_by !== ctx.userId) {
    throw new InvalidInput("evidence is filed by whoever uploaded it");
  }
}

async function insertEventProvenance(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
): Promise<string> {
  return insertProvenance(tx, ctx, projectId, {
    title: "Convocatoria a socialización",
    note: "Evento de socialización convocado por la consultoría.",
    method:
      "Registro de la convocatoria: título, fecha, hora, zona horaria y lugar, tal como se " +
      "comunican en la invitación.",
  });
}

async function insertInvitationProvenance(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
): Promise<string> {
  return insertProvenance(tx, ctx, projectId, {
    title: "Invitación a socialización",
    note: "Un predio invitado a un evento. No registra asistencia ni datos de personas.",
    method:
      "Invitación generada sobre una selección de predios; la entrega se registra en campo con " +
      "evidencia fotográfica.",
  });
}

async function insertProvenance(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  words: { title: string; note: string; method: string },
): Promise<string> {
  const id = randomUUID();
  await tx.insert(appSchema.provenanceRecord).values({
    id,
    tenantId: ctx.tenantId,
    projectId,
    regime: "LIVE_OPERATIONAL",
    origin: "FIELD_CAPTURE",
    transformations: ["ORIGINAL"],
    granularity: "INDIVIDUAL",
    title: words.title,
    note: words.note,
    method: words.method,
    capturedAt: new Date(),
    validationState: "PENDING",
  });
  return id;
}

export type { DeliveryOutcome };

/* ---------------------------------------------------------------------------------------------
 * read models
 * ------------------------------------------------------------------------------------------ */

export interface SocializationEventSummary {
  readonly eventId: string;
  readonly title: string;
  readonly purpose: string | null;
  readonly startsAt: Date;
  readonly timezone: string;
  readonly locationLabel: string;
  readonly status: SocializationEventStatus;
  /**
   * Counts over **invitations**, which is the unit of the convocation. `attempts` is beside them
   * and is deliberately not one of them: three visits to one gate are one invitee, and a figure
   * that mixed the two would answer neither question.
   */
  readonly invitations: number;
  readonly delivered: number;
  readonly pending: number;
  readonly refused: number;
  readonly cancelled: number;
  readonly attempts: number;
}

export async function listSocializationEvents(
  db: Database,
  ctx: RequestContext,
): Promise<ReadonlyArray<SocializationEventSummary>> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.socializations.manage");
  const projectId = requireProject(ctx);

  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      title: string;
      purpose: string | null;
      starts_at: string;
      timezone: string;
      location_label: string;
      status: SocializationEventStatus;
      invitations: number;
      delivered: number;
      pending: number;
      refused: number;
      cancelled: number;
      attempts: number;
    }>(sql`
      select e.id, e.title, e.purpose, e.starts_at, e.timezone, e.location_label,
             e.status::text                                               as status,
             count(i.id)::int                                             as invitations,
             count(i.id) filter (where i.status = 'DELIVERED')::int        as delivered,
             count(i.id) filter (where i.status = 'PENDING')::int          as pending,
             count(i.id) filter (where i.status = 'REFUSED')::int          as refused,
             count(i.id) filter (where i.status = 'CANCELLED')::int        as cancelled,
             coalesce((select count(*) from app.socialization_delivery_attempt a
                        join app.socialization_invitation ai
                          on ai.tenant_id = a.tenant_id and ai.id = a.invitation_id
                       where ai.tenant_id = e.tenant_id and ai.event_id = e.id), 0)::int as attempts
        from app.socialization_event e
        left join app.socialization_invitation i
          on i.tenant_id = e.tenant_id and i.event_id = e.id
       where e.tenant_id = ${ctx.tenantId} and e.project_id = ${projectId}
       group by e.id
       order by e.starts_at desc
    `);
    return rows.rows.map((row) => ({
      eventId: row.id,
      title: row.title,
      purpose: row.purpose,
      // `tx.execute` hands back what the driver gives; the repository's convention is to make a
      // Date here rather than let one reach a formatter as a string.
      startsAt: new Date(row.starts_at),
      timezone: row.timezone,
      locationLabel: row.location_label,
      status: row.status,
      invitations: Number(row.invitations),
      delivered: Number(row.delivered),
      pending: Number(row.pending),
      refused: Number(row.refused),
      cancelled: Number(row.cancelled),
      attempts: Number(row.attempts),
    }));
  });
}

export interface SocializationInvitationRow {
  readonly invitationId: string;
  readonly parcelId: string;
  readonly parcelCode: string;
  readonly recipientLabel: string | null;
  readonly status: SocializationInvitationStatus;
  readonly revision: number;
  readonly assigneeMembershipId: string;
  readonly assigneeName: string | null;
  readonly attempts: ReadonlyArray<{
    readonly attemptId: string;
    readonly outcome: DeliveryOutcome;
    readonly occurredAt: Date;
    readonly technicianName: string | null;
    readonly note: string | null;
    readonly hasEvidence: boolean;
    readonly evidenceStoredObjectId: string | null;
  }>;
}

export interface SocializationEventDetail extends SocializationEventSummary {
  readonly invitationRows: ReadonlyArray<SocializationInvitationRow>;
}

/**
 * One event with every invitation and the attempts under each.
 *
 * The attempts are nested rather than listed beside the invitations, because that is the
 * relationship: an attempt is only meaningful as *an attempt at this invitation*, and a flat list
 * is the shape that invites somebody to count them as invitees.
 */
export async function loadSocializationEvent(
  db: Database,
  ctx: RequestContext,
  eventId: string,
): Promise<SocializationEventDetail> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.socializations.manage");
  const projectId = requireProject(ctx);

  const summaries = await listSocializationEvents(db, ctx);
  const summary = summaries.find((e) => e.eventId === eventId);
  if (!summary) throw new NotFound("socialization event");

  const invitationRows = await withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      parcel_id: string;
      parcel_code: string;
      recipient_label: string | null;
      status: SocializationInvitationStatus;
      revision: number;
      assignee_membership_id: string;
      assignee_name: string | null;
      attempt_id: string | null;
      outcome: DeliveryOutcome | null;
      occurred_at: string | null;
      technician_name: string | null;
      note: string | null;
      evidence: string | null;
    }>(sql`
      select i.id, i.parcel_id, p.parcel_code, i.recipient_label,
             i.status::text            as status,
             i.revision                as revision,
             i.assignee_membership_id  as assignee_membership_id,
             coalesce(au.name, au.email) as assignee_name,
             a.id                      as attempt_id,
             a.outcome::text           as outcome,
             a.occurred_at_device      as occurred_at,
             coalesce(tu.name, tu.email) as technician_name,
             a.note                    as note,
             a.evidence_stored_object_id as evidence
        from app.socialization_invitation i
        join app.parcel p on p.tenant_id = i.tenant_id and p.id = i.parcel_id
        left join app.project_membership pm
          on pm.tenant_id = i.tenant_id and pm.id = i.assignee_membership_id
        left join app.tenant_membership tm
          on tm.tenant_id = pm.tenant_id and tm.id = pm.tenant_membership_id
        left join app."user" au on au.id = tm.user_id
        left join app.socialization_delivery_attempt a
          on a.tenant_id = i.tenant_id and a.invitation_id = i.id
        left join app."user" tu on tu.id = a.technician_user_id
       where i.tenant_id = ${ctx.tenantId} and i.project_id = ${projectId}
         and i.event_id = ${eventId}
       order by p.parcel_code, a.occurred_at_device
    `);

    const byInvitation = new Map<string, SocializationInvitationRow>();
    for (const row of rows.rows) {
      let entry = byInvitation.get(row.id);
      if (!entry) {
        entry = {
          invitationId: row.id,
          parcelId: row.parcel_id,
          parcelCode: row.parcel_code,
          recipientLabel: row.recipient_label,
          status: row.status,
          revision: Number(row.revision),
          assigneeMembershipId: row.assignee_membership_id,
          assigneeName: row.assignee_name,
          attempts: [],
        };
        byInvitation.set(row.id, entry);
      }
      if (row.attempt_id !== null) {
        (entry.attempts as Array<SocializationInvitationRow["attempts"][number]>).push({
          attemptId: row.attempt_id,
          outcome: row.outcome!,
          occurredAt: new Date(row.occurred_at!),
          technicianName: row.technician_name,
          note: row.note,
          hasEvidence: row.evidence !== null,
          evidenceStoredObjectId: row.evidence,
        });
      }
    }
    return [...byInvitation.values()];
  });

  return { ...summary, invitationRows };
}

export interface PrintableInvitation {
  readonly invitationId: string;
  readonly firmName: string | null;
  readonly engagementLabel: string | null;
  readonly projectName: string;
  readonly parcelCode: string;
  readonly recipientLabel: string | null;
  readonly eventTitle: string;
  readonly purpose: string | null;
  readonly startsAt: Date;
  readonly timezone: string;
  readonly locationLabel: string;
  readonly status: SocializationInvitationStatus;
}

/**
 * Everything the printed sheet says, and nothing else.
 *
 * No technician, no attempt, no evidence, no coordinate: the piece of paper is read by whoever
 * receives it, and what this product knows about its own operation is not theirs to hold. The
 * firm's name comes from the editorial profile when the firm set one, because that is the name
 * it has already chosen to be known by publicly.
 */
export async function loadPrintableInvitation(
  db: Database,
  ctx: RequestContext,
  invitationId: string,
): Promise<PrintableInvitation> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.socializations.manage");
  const projectId = requireProject(ctx);

  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      parcel_code: string;
      recipient_label: string | null;
      status: SocializationInvitationStatus;
      title: string;
      purpose: string | null;
      starts_at: string;
      timezone: string;
      location_label: string;
      project_name: string;
      firm_name: string | null;
      engagement_label: string | null;
    }>(sql`
      select i.id, p.parcel_code, i.recipient_label,
             i.status::text as status,
             e.title, e.purpose, e.starts_at, e.timezone, e.location_label,
             pr.name        as project_name,
             tp.name        as firm_name,
             tp.engagement_label as engagement_label
        from app.socialization_invitation i
        join app.socialization_event e on e.tenant_id = i.tenant_id and e.id = i.event_id
        join app.parcel p on p.tenant_id = i.tenant_id and p.id = i.parcel_id
        join app.project pr on pr.tenant_id = i.tenant_id and pr.id = i.project_id
        left join portal.editorial_tenant_profile tp on tp.tenant_id = i.tenant_id
       where i.tenant_id = ${ctx.tenantId} and i.project_id = ${projectId} and i.id = ${invitationId}
       limit 1
    `);
    const row = rows.rows[0];
    if (!row) throw new NotFound("socialization invitation");
    return {
      invitationId: row.id,
      firmName: row.firm_name,
      engagementLabel: row.engagement_label,
      projectName: row.project_name,
      parcelCode: row.parcel_code,
      recipientLabel: row.recipient_label,
      eventTitle: row.title,
      purpose: row.purpose,
      startsAt: new Date(row.starts_at),
      timezone: row.timezone,
      locationLabel: row.location_label,
      status: row.status,
    };
  });
}
