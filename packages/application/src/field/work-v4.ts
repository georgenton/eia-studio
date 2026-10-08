import { withDbContext, type Database, type DbTx } from "@eia/db";
import {
  deriveOfflineWindow,
  formatChainage,
  requireCapability,
  requirePermission,
  type RequestContext,
} from "@eia/domain";
import {
  FIELD_PACK_SCHEMA_VERSION_V4,
  FIELD_SYNC_PROTOCOL_VERSION_V4,
  workPackSchema,
  workPullResponseSchema,
  type FieldProjectWithWork,
  type FieldWorkScopeResponse,
  type PackInvitation,
  type PackSurveyWork,
  type WorkPack,
  type WorkPackResponse,
  type WorkPullResponse,
} from "@eia/field-sync-contract";
import { sql } from "drizzle-orm";

import { listUserTenants } from "../tenancy/request-context";
import { withFieldContext } from "./context";
import { buildFieldPack } from "./field-pack";
import { pullFieldChanges } from "./sync";

/**
 * Protocol v4: a technician's work is surveys **and** invitations, in any number of projects.
 *
 * ## Why this file exists beside the v3 one
 *
 * v3's `/scope`, `/pack`, `/pull` and `/sync` are untouched, because a signed build speaking
 * them must keep working (block 3 §G). Everything here is reached through `/api/field/v4/*` and
 * composes the v3 builders rather than reimplementing them: `buildFieldPack` already knows how
 * to read a campaign, its questionnaire and a technician's assignments, and a second copy of
 * that query is a second place for the pack to go wrong.
 *
 * ## The one thing v3 could not express
 *
 * A project whose survey campaign closed last month, with five invitations still to deliver, is
 * a project a technician must be able to work in. v3's pack requires a campaign, so it answered
 * `no_active_campaign` and the device had nothing to do. Here `surveyWork` is nullable, and the
 * pack is valid with it absent.
 */

/* ---------------------------------------------------------------------------------------------
 * Discovery
 * ------------------------------------------------------------------------------------------ */

/**
 * In which projects does this person have work?
 *
 * Eligibility is **work**, never membership: an own survey assignment that is `PENDING` or
 * `IN_PROGRESS` in an `ACTIVE` campaign, or an own `PENDING` invitation. Somebody added to six
 * projects and given work in one appears in one.
 *
 * The answer is a list even when it has one entry. v3 had to collapse "several" into a terminal
 * state because the application held one pack by database constraint; v4 hands the technician
 * the choice instead, because which study their morning belongs to is theirs to make.
 *
 * No privileged read: `listUserTenants` runs with `app.user_id` set and `app.tenant_id` unset,
 * each tenant is then adopted in turn, and the row-level policies return exactly this person's
 * own rows — the same ordering `resolveFieldScope` uses.
 */
export async function resolveFieldWorkScope(
  db: Database,
  userId: string,
): Promise<FieldWorkScopeResponse> {
  const tenants = await listUserTenants(db, userId);
  const projects: FieldProjectWithWork[] = [];

  for (const tenant of tenants) {
    const rows = await withDbContext(
      db,
      { userId, tenantId: tenant.id, projectId: null },
      async (tx) => {
        const found = await tx.execute<{
          project_slug: string;
          project_name: string;
          has_survey: boolean;
          has_socialization: boolean;
        }>(sql`
          with survey_work as (
            select distinct a.project_id
              from app.field_assignment a
              join app.survey_campaign c
                on c.tenant_id = a.tenant_id and c.id = a.campaign_id
             where a.assignee_user_id = ${userId}
               and a.status in ('PENDING', 'IN_PROGRESS')
               and c.status = 'ACTIVE'
          ),
          socialization_work as (
            select distinct i.project_id
              from app.socialization_invitation i
              join app.socialization_event e
                on e.tenant_id = i.tenant_id and e.id = i.event_id
             where i.assignee_user_id = ${userId}
               and i.status = 'PENDING'
               and e.status in ('DRAFT', 'SCHEDULED')
          )
          select p.slug as project_slug,
                 p.name as project_name,
                 (sw.project_id is not null) as has_survey,
                 (zw.project_id is not null) as has_socialization
            from app.project p
            left join survey_work sw on sw.project_id = p.id
            left join socialization_work zw on zw.project_id = p.id
           where sw.project_id is not null or zw.project_id is not null
           order by p.slug
        `);
        return found.rows;
      },
    );

    for (const row of rows) {
      const work: Array<"survey" | "socialization"> = [];
      if (row.has_survey === true) work.push("survey");
      if (row.has_socialization === true) work.push("socialization");
      if (work.length === 0) continue;
      projects.push({
        tenantSlug: tenant.slug,
        projectSlug: row.project_slug,
        projectName: row.project_name,
        work,
      });
    }
  }

  return { protocolVersion: FIELD_SYNC_PROTOCOL_VERSION_V4, projects };
}

/* ---------------------------------------------------------------------------------------------
 * The pack
 * ------------------------------------------------------------------------------------------ */

export interface WorkPackOptions {
  readonly sessionExpiresAt: Date;
  readonly technician: { readonly email: string; readonly name: string | null };
  readonly now?: Date;
}

export async function buildWorkPack(
  db: Database,
  ctx: RequestContext,
  options: WorkPackOptions,
): Promise<WorkPackResponse> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.assignments.read_own");
  requirePermission(ctx, "field.capture");
  if (ctx.projectId === null) throw new Error("buildWorkPack requires a project context");
  const now = options.now ?? new Date();

  /*
   * The survey half comes from v3's own builder, so there is exactly one implementation of "what
   * does a technician need to run a questionnaire offline?". Its `no_work` outcomes are not
   * failures here: they mean *this project has no survey work*, which v4 can represent.
   */
  const surveyResponse = await buildFieldPack(db, ctx, options);
  const surveyWork: PackSurveyWork | null =
    surveyResponse.kind === "pack"
      ? {
          campaign: surveyResponse.pack.campaign,
          assignments: surveyResponse.pack.assignments,
        }
      : null;

  const invitations = await readInvitations(db, ctx, ctx.projectId);

  if (surveyWork === null && invitations.length === 0) {
    return {
      kind: "no_work",
      reason: "no_work_assigned",
      message:
        "No tienes predios asignados ni invitaciones por entregar en este proyecto. Habla con " +
        "la coordinación si crees que deberías tenerlos.",
    };
  }

  const project =
    surveyResponse.kind === "pack"
      ? surveyResponse.pack.project
      : await readProjectForPack(db, ctx, ctx.projectId);
  const window = deriveOfflineWindow({ now, sessionExpiresAt: options.sessionExpiresAt });

  const pack: WorkPack = {
    schemaVersion: FIELD_PACK_SCHEMA_VERSION_V4,
    protocolVersion: FIELD_SYNC_PROTOCOL_VERSION_V4,
    technician: {
      userId: ctx.userId,
      email: options.technician.email,
      name: options.technician.name,
    },
    project,
    surveyWork,
    socializationWork: { invitations: [...invitations] },
    validity: {
      issuedAt: window.issuedAt.toISOString(),
      expiresAt: window.expiresAt.toISOString(),
      basis: window.basis,
    },
    cursor: encodeWorkCursor(now),
  };

  // Parsed on the way out, for the reason v3's builder gives: a pack that does not satisfy its
  // own contract is a bug we would otherwise discover on a phone in a valley.
  return { kind: "pack", pack: workPackSchema.parse(pack) };
}

/* ---------------------------------------------------------------------------------------------
 * Pull
 * ------------------------------------------------------------------------------------------ */

/**
 * Reconcile: the current set of each kind, plus what is no longer this technician's.
 *
 * `revokedInvitationIds` is computed by asking for the invitations that exist for this event
 * set and are **not** the caller's — which, under the row-level policy, is simply "the ones the
 * caller can no longer see". The device removes them from its list and keeps any local work
 * against them, marked for review. Nothing here authorises deleting a capture.
 */
export async function pullWorkChanges(
  db: Database,
  ctx: RequestContext,
  input: {
    readonly knownAssignmentIds: ReadonlyArray<string>;
    readonly knownInvitationIds: ReadonlyArray<string>;
    readonly now?: Date;
  },
  options: WorkPackOptions,
): Promise<WorkPullResponse> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.assignments.read_own");
  if (ctx.projectId === null) throw new Error("pullWorkChanges requires a project context");
  const now = input.now ?? new Date();

  /*
   * The survey half, from v3's own puller, which answers `null` when there is no active
   * campaign. In v3 that was the end of the road; here it is simply one of the two shapes a
   * project can have, and the invitations below are the other.
   */
  const pulled = await pullFieldChanges(
    db,
    ctx,
    { knownAssignmentIds: input.knownAssignmentIds, sessionExpiresAt: options.sessionExpiresAt },
    { now },
  );

  const invitations = await readInvitations(db, ctx, ctx.projectId);
  const current = new Set(invitations.map((i) => i.invitationId));
  const revokedInvitationIds = input.knownInvitationIds.filter((id) => !current.has(id));

  const window = deriveOfflineWindow({ now, sessionExpiresAt: options.sessionExpiresAt });

  return workPullResponseSchema.parse({
    protocolVersion: FIELD_SYNC_PROTOCOL_VERSION_V4,
    surveyChanges:
      pulled === null
        ? null
        : {
            campaignStatus: pulled.campaignStatus,
            surveyVersionId: pulled.surveyVersionId,
            assignments: pulled.assignments,
          },
    revokedAssignmentIds: pulled === null ? [] : [...pulled.revokedAssignmentIds],
    socializationWork: { invitations: [...invitations] },
    revokedInvitationIds,
    validity: {
      issuedAt: window.issuedAt.toISOString(),
      expiresAt: window.expiresAt.toISOString(),
      basis: window.basis,
    },
    cursor: encodeWorkCursor(now),
  } satisfies WorkPullResponse);
}

/* ---------------------------------------------------------------------------------------------
 * reading invitations
 * ------------------------------------------------------------------------------------------ */

/**
 * The caller's own open invitations, with the event's words beside each.
 *
 * Bounded by the row-level policy as well as by the predicate: a technician holds neither
 * `field.responses.read` nor another person's rows, so this query cannot return somebody else's
 * invitation even if the `where` were wrong.
 *
 * A `CANCELLED` event's invitations are excluded. The device is told they are gone by their
 * absence here and by `revokedInvitationIds` on the next pull — it keeps any local attempt and
 * marks it for review rather than discarding a technician's walk.
 */
async function readInvitations(
  db: Database,
  ctx: RequestContext,
  projectId: string,
): Promise<ReadonlyArray<PackInvitation>> {
  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      revision: number;
      status: PackInvitation["status"];
      parcel_id: string;
      parcel_code: string;
      sector_label: string | null;
      chainage_m: string | null;
      recipient_label: string | null;
      event_id: string;
      title: string;
      starts_at: string;
      timezone: string;
      location_label: string;
      purpose: string | null;
    }>(sql`
      select i.id, i.revision, i.status::text as status,
             i.parcel_id, p.parcel_code, p.sector_label,
             p.chainage_m,
             i.recipient_label,
             e.id as event_id, e.title, e.starts_at, e.timezone, e.location_label, e.purpose
        from app.socialization_invitation i
        join app.socialization_event e on e.tenant_id = i.tenant_id and e.id = i.event_id
        join app.parcel p on p.tenant_id = i.tenant_id and p.id = i.parcel_id
       where i.tenant_id = ${ctx.tenantId} and i.project_id = ${projectId}
         and i.assignee_user_id = ${ctx.userId}
         and i.status = 'PENDING'
         and e.status in ('DRAFT', 'SCHEDULED')
       order by e.starts_at, p.parcel_code
    `);

    return rows.rows.map((row) => ({
      invitationId: row.id,
      revision: Number(row.revision),
      status: row.status,
      parcelId: row.parcel_id,
      parcelCode: row.parcel_code,
      sectorLabel: row.sector_label,
      // Formatted here, like v3's parcel context: an abscissa is notation, not a number a
      // phone should decide how to write.
      chainageLabel: row.chainage_m === null ? null : formatChainage(Number(row.chainage_m)),
      recipientLabel: row.recipient_label,
      eventId: row.event_id,
      eventTitle: row.title,
      startsAt: new Date(row.starts_at).toISOString(),
      timezone: row.timezone,
      locationLabel: row.location_label,
      purpose: row.purpose,
    }));
  });
}

async function readProjectForPack(
  db: Database,
  ctx: RequestContext,
  projectId: string,
): Promise<WorkPack["project"]> {
  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute<{
      project_slug: string;
      project_name: string;
      locality: string | null;
      tenant_slug: string;
      tenant_name: string;
    }>(sql`
      select p.slug as project_slug, p.name as project_name, p.location_label as locality,
             t.slug as tenant_slug, t.name as tenant_name
        from app.project p join app.tenant t on t.id = p.tenant_id
       where p.tenant_id = ${ctx.tenantId} and p.id = ${projectId}
       limit 1
    `);
    const row = rows.rows[0];
    if (!row) throw new Error("project not visible in context");
    return {
      tenantId: ctx.tenantId,
      tenantSlug: row.tenant_slug,
      tenantName: row.tenant_name,
      projectId,
      projectSlug: row.project_slug,
      projectName: row.project_name,
      locality: row.locality,
    };
  });
}

/** Opaque to the device, and deliberately the same shape v3's cursor has. */
export function encodeWorkCursor(at: Date): string {
  return `v4:${at.toISOString()}`;
}

export type { DbTx };
