import { randomUUID } from "node:crypto";

import { appSchema, fieldSchema, type Database, type DbTx } from "@eia/db";
import {
  assertAssignmentReassignable,
  InvalidInput,
  NotFound,
  requireCapability,
  requirePermission,
  type AssignmentStatus,
  type RequestContext,
} from "@eia/domain";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../audit/record";
import { withFieldContext } from "./context";

/**
 * Deciding who goes where.
 *
 * `field.assignments.manage` has existed since Slice 3 and until now had nothing to grant: a
 * campaign's assignments arrived from a seeder, and the only way a parcel changed hands was a
 * correction revisit. This is the product act the permission was written for.
 *
 * ## What it deliberately does not do
 *
 * No automatic distribution, no round-robin, no routing, no model. Somebody looks at the corridor
 * and decides, one parcel at a time, and the record says who decided. A planner that assigned
 * 141 parcels by itself would be making a judgement about people's days that nobody could later
 * account for — and the first thing it would need is where each technician lives.
 *
 * ## Why the server resolves the person
 *
 * The browser sends a **project membership id**, never a user id, and the server turns it into a
 * user through `app.project_membership` joined to `app.tenant_membership` under the caller's own
 * RLS. A user id from a form body is a value the sender chose; a membership of this project is a
 * fact this project holds.
 */

/* ---------------------------------------------------------------------------------------------
 * Who may be assigned
 * ------------------------------------------------------------------------------------------ */

export interface EligibleTechnician {
  readonly membershipId: string;
  readonly userId: string;
  readonly name: string | null;
  readonly email: string;
  /** Live ordinary assignments in the campaign being looked at, so a chooser sees the load. */
  readonly openAssignments: number;
}

/**
 * The technicians of **this** project, and nobody else.
 *
 * `FIELD_TECHNICIAN` and `status = 'active'`: a suspended membership is not a person who can be
 * sent out, and a technician of another project is not one either. The count beside each name is
 * their live ordinary work in this campaign — information for whoever is choosing, never a rule
 * the product applies by itself.
 */
export async function listEligibleTechnicians(
  db: Database,
  ctx: RequestContext,
  campaignId: string,
): Promise<ReadonlyArray<EligibleTechnician>> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.assignments.manage");
  const projectId = requireProject(ctx);

  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute<{
      membership_id: string;
      user_id: string;
      name: string | null;
      email: string;
      open_assignments: number;
    }>(sql`
      select pm.id                                   as membership_id,
             tm.user_id                              as user_id,
             u.name                                  as name,
             u.email                                 as email,
             count(fa.id) filter (
               where fa.campaign_id = ${campaignId}
                 and fa.corrects_assignment_id is null
                 and fa.status in ('PENDING', 'IN_PROGRESS')
             )::int                                  as open_assignments
        from app.project_membership pm
        join app.tenant_membership tm
          on tm.tenant_id = pm.tenant_id and tm.id = pm.tenant_membership_id
        join app."user" u on u.id = tm.user_id
        left join app.field_assignment fa
          on fa.tenant_id = pm.tenant_id and fa.assignee_membership_id = pm.id
       where pm.tenant_id = ${ctx.tenantId}
         and pm.project_id = ${projectId}
         and pm.status = 'active'
         and pm.role = 'FIELD_TECHNICIAN'
       group by pm.id, tm.user_id, u.name, u.email
       order by u.name nulls last, u.email
    `);
    return rows.rows.map((row) => ({
      membershipId: row.membership_id,
      userId: row.user_id,
      name: row.name,
      email: row.email,
      openAssignments: Number(row.open_assignments),
    }));
  });
}

/* ---------------------------------------------------------------------------------------------
 * What there is to decide
 * ------------------------------------------------------------------------------------------ */

export interface AssignmentBoardRow {
  readonly parcelId: string;
  readonly parcelCode: string;
  readonly sectorLabel: string | null;
  readonly assignmentId: string | null;
  readonly status: AssignmentStatus | null;
  readonly assigneeMembershipId: string | null;
  readonly assigneeName: string | null;
  /** True once a visit, a response or a photograph exists: the assignment stops being movable. */
  readonly workStarted: boolean;
}

export interface AssignmentBoard {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly campaignStatus: string;
  readonly rows: ReadonlyArray<AssignmentBoardRow>;
}

/**
 * Every parcel of the project beside the ordinary assignment it currently has, if any.
 *
 * Parcels rather than assignments, because the question being answered is *who is going to each
 * parcel* and an unassigned one is the interesting case. Correction revisits are excluded: they
 * are a different act with their own surface (ADR-038), and showing them here would invite
 * somebody to move one.
 */
export async function loadAssignmentBoard(
  db: Database,
  ctx: RequestContext,
  campaignId: string,
): Promise<AssignmentBoard> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.assignments.manage");
  const projectId = requireProject(ctx);

  return withFieldContext(db, ctx, async (tx) => {
    const campaigns = await tx.execute<{ id: string; name: string; status: string }>(sql`
      select id, name, status::text as status
        from app.survey_campaign
       where tenant_id = ${ctx.tenantId} and project_id = ${projectId} and id = ${campaignId}
       limit 1
    `);
    const campaign = campaigns.rows[0];
    if (!campaign) throw new NotFound("survey campaign");

    const rows = await tx.execute<{
      parcel_id: string;
      parcel_code: string;
      sector_label: string | null;
      assignment_id: string | null;
      status: AssignmentStatus | null;
      assignee_membership_id: string | null;
      assignee_name: string | null;
      work_started: boolean;
    }>(sql`
      select p.id                      as parcel_id,
             p.parcel_code             as parcel_code,
             p.sector_label            as sector_label,
             fa.id                     as assignment_id,
             fa.status::text           as status,
             fa.assignee_membership_id as assignee_membership_id,
             coalesce(u.name, u.email) as assignee_name,
             coalesce(
               exists (select 1 from app.field_visit v
                        where v.tenant_id = fa.tenant_id and v.assignment_id = fa.id)
               or exists (select 1 from app.survey_instance si
                           where si.tenant_id = fa.tenant_id and si.assignment_id = fa.id),
               false
             )                         as work_started
        from app.parcel p
        left join app.field_assignment fa
          on fa.tenant_id = p.tenant_id
         and fa.parcel_id = p.id
         and fa.campaign_id = ${campaignId}
         and fa.corrects_assignment_id is null
         and fa.status <> 'CANCELLED'
        left join app.project_membership pm
          on pm.tenant_id = fa.tenant_id and pm.id = fa.assignee_membership_id
        left join app.tenant_membership tm
          on tm.tenant_id = pm.tenant_id and tm.id = pm.tenant_membership_id
        left join app."user" u on u.id = tm.user_id
       where p.tenant_id = ${ctx.tenantId} and p.project_id = ${projectId}
       order by p.parcel_code
    `);

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignStatus: campaign.status,
      rows: rows.rows.map((row) => ({
        parcelId: row.parcel_id,
        parcelCode: row.parcel_code,
        sectorLabel: row.sector_label,
        assignmentId: row.assignment_id,
        status: row.status,
        assigneeMembershipId: row.assignee_membership_id,
        assigneeName: row.assignee_name,
        workStarted: row.work_started === true,
      })),
    };
  });
}

/* ---------------------------------------------------------------------------------------------
 * Deciding
 * ------------------------------------------------------------------------------------------ */

export const assignParcelInputSchema = z
  .object({
    campaignId: z.uuid(),
    parcelId: z.uuid(),
    /** A membership of this project. Never a user id: see the note at the top of this file. */
    assigneeMembershipId: z.uuid(),
    note: z.string().max(300).nullable().default(null),
  })
  .strict();
export type AssignParcelInput = z.infer<typeof assignParcelInputSchema>;

/**
 * Send somebody to a parcel that nobody is going to.
 *
 * Refuses when a live ordinary assignment already exists, rather than quietly replacing it — the
 * partial unique index would refuse anyway, and a caller who meant to change who goes has a
 * different verb for it.
 */
export async function assignParcel(
  db: Database,
  ctx: RequestContext,
  raw: AssignParcelInput,
): Promise<{ assignmentId: string }> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.assignments.manage");
  const projectId = requireProject(ctx);
  const input = assignParcelInputSchema.parse(raw);

  return withFieldContext(db, ctx, async (tx) => {
    const campaign = await readOpenCampaign(tx, ctx, projectId, input.campaignId);
    await assertParcelBelongsHere(tx, ctx, projectId, input.parcelId);
    const assignee = await readTechnician(tx, ctx, projectId, input.assigneeMembershipId);

    const existing = await tx.execute<{ id: string }>(sql`
      select id from app.field_assignment
       where tenant_id = ${ctx.tenantId}
         and campaign_id = ${input.campaignId}
         and parcel_id = ${input.parcelId}
         and corrects_assignment_id is null
         and status <> 'CANCELLED'
       limit 1
    `);
    if (existing.rows[0]) {
      throw new InvalidInput(
        "this parcel already has a live assignment in this campaign; change who it is assigned to " +
          "instead of adding a second",
      );
    }

    const provenanceId = randomUUID();
    await tx.insert(appSchema.provenanceRecord).values({
      id: provenanceId,
      tenantId: ctx.tenantId,
      projectId,
      regime: campaign.regime === "DEMO_SIMULATION" ? "DEMO_SIMULATION" : "LIVE_OPERATIONAL",
      origin: "FIELD_CAPTURE",
      transformations: ["ORIGINAL"],
      granularity: "INDIVIDUAL",
      title: "Asignación de levantamiento",
      note: "Predio asignado a una persona del equipo de campo desde el escritorio.",
      method:
        "Asignación decidida por una persona autorizada; no hay distribución automática ni " +
        "optimización de rutas.",
      capturedAt: new Date(),
      validationState: "PENDING",
    });

    const assignmentId = randomUUID();
    await tx.insert(fieldSchema.fieldAssignment).values({
      id: assignmentId,
      tenantId: ctx.tenantId,
      projectId,
      campaignId: input.campaignId,
      parcelId: input.parcelId,
      assigneeMembershipId: assignee.membershipId,
      assigneeUserId: assignee.userId,
      status: "PENDING",
      note: input.note,
      provenanceId,
    });

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.assignment.created",
        objectKind: "field_assignment",
        objectId: assignmentId,
        // Identifiers. Never the note, which is free text somebody typed about a household.
        details: {
          campaignId: input.campaignId,
          parcelId: input.parcelId,
          assigneeMembershipId: assignee.membershipId,
        },
      },
    );

    return { assignmentId };
  });
}

export const reassignAssignmentInputSchema = z
  .object({ assignmentId: z.uuid(), assigneeMembershipId: z.uuid() })
  .strict();
export type ReassignAssignmentInput = z.infer<typeof reassignAssignmentInputSchema>;

/**
 * Change who is going, before anybody has gone.
 *
 * The row moves rather than being replaced, which keeps the campaign's one-live-assignment rule
 * intact and keeps the parcel's history in one place. What stops this being a way to rewrite
 * yesterday is `assertAssignmentReassignable`: the moment a visit, a response or a photograph
 * exists the answer is no, and the error says which door to use instead.
 */
export async function reassignAssignment(
  db: Database,
  ctx: RequestContext,
  raw: ReassignAssignmentInput,
): Promise<{ assignmentId: string; previousMembershipId: string }> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.assignments.manage");
  const projectId = requireProject(ctx);
  const input = reassignAssignmentInputSchema.parse(raw);

  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      status: AssignmentStatus;
      assignee_membership_id: string;
      corrects_assignment_id: string | null;
      has_visit: boolean;
      has_instance: boolean;
      has_media: boolean;
    }>(sql`
      select fa.id,
             fa.status::text            as status,
             fa.assignee_membership_id  as assignee_membership_id,
             fa.corrects_assignment_id  as corrects_assignment_id,
             exists (select 1 from app.field_visit v
                      where v.tenant_id = fa.tenant_id and v.assignment_id = fa.id)  as has_visit,
             exists (select 1 from app.survey_instance si
                      where si.tenant_id = fa.tenant_id and si.assignment_id = fa.id) as has_instance,
             exists (select 1 from app.field_media m
                       join app.field_visit v2
                         on v2.tenant_id = m.tenant_id and v2.id = m.visit_id
                      where m.tenant_id = fa.tenant_id and v2.assignment_id = fa.id)  as has_media
        from app.field_assignment fa
       where fa.tenant_id = ${ctx.tenantId} and fa.project_id = ${projectId}
         and fa.id = ${input.assignmentId}
       limit 1
    `);
    const current = rows.rows[0];
    if (!current) throw new NotFound("field assignment");

    assertAssignmentReassignable({
      status: current.status,
      hasVisit: current.has_visit === true,
      hasInstance: current.has_instance === true,
      hasMedia: current.has_media === true,
      isCorrection: current.corrects_assignment_id !== null,
    });

    const assignee = await readTechnician(tx, ctx, projectId, input.assigneeMembershipId);
    if (assignee.membershipId === current.assignee_membership_id) {
      throw new InvalidInput("this assignment already belongs to that technician");
    }

    await tx
      .update(fieldSchema.fieldAssignment)
      .set({ assigneeMembershipId: assignee.membershipId, assigneeUserId: assignee.userId })
      .where(
        and(
          eq(fieldSchema.fieldAssignment.tenantId, ctx.tenantId),
          eq(fieldSchema.fieldAssignment.id, input.assignmentId),
        ),
      );

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.assignment.reassigned",
        objectKind: "field_assignment",
        objectId: input.assignmentId,
        details: {
          fromMembershipId: current.assignee_membership_id,
          toMembershipId: assignee.membershipId,
        },
      },
    );

    return {
      assignmentId: input.assignmentId,
      previousMembershipId: current.assignee_membership_id,
    };
  });
}

/* ---------------------------------------------------------------------------------------------
 * helpers
 * ------------------------------------------------------------------------------------------ */

function requireProject(ctx: RequestContext): string {
  if (!ctx.projectId) throw new InvalidInput("this action needs a project in context");
  return ctx.projectId;
}

/** A campaign that can still receive work, and the regime its provenance should carry. */
async function readOpenCampaign(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  campaignId: string,
): Promise<{ regime: string }> {
  const rows = await tx.execute<{ status: string; regime: string }>(sql`
    select c.status::text as status, pr.regime::text as regime
      from app.survey_campaign c
      join app.provenance_record pr on pr.tenant_id = c.tenant_id and pr.id = c.provenance_id
     where c.tenant_id = ${ctx.tenantId} and c.project_id = ${projectId} and c.id = ${campaignId}
     limit 1
  `);
  const row = rows.rows[0];
  if (!row) throw new NotFound("survey campaign");
  if (row.status === "CLOSED") {
    throw new InvalidInput("this campaign is closed; a closed campaign receives no new work");
  }
  return { regime: row.regime };
}

async function assertParcelBelongsHere(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  parcelId: string,
): Promise<void> {
  const rows = await tx.execute<{ id: string }>(sql`
    select id from app.parcel
     where tenant_id = ${ctx.tenantId} and project_id = ${projectId} and id = ${parcelId}
     limit 1
  `);
  if (!rows.rows[0]) throw new NotFound("parcel");
}

/**
 * A membership id becomes a person, here and nowhere else.
 *
 * The role is checked in the query rather than afterwards, so a membership of this project that
 * is not a technician's is simply not found — the same answer a membership of another project
 * gets, which is what stops the form from being used to enumerate the team.
 */
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
