import { appSchema, type Database, type DbTx } from "@eia/db";
import {
  deriveOfflineWindow,
  formatChainage,
  PARCEL_SIDE_LABEL,
  requireCapability,
  requirePermission,
  type AssignmentStatus,
  type InstanceStatus,
  type ParcelSide,
  type RequestContext,
} from "@eia/domain";
import {
  FIELD_PACK_SCHEMA_VERSION,
  FIELD_SYNC_PROTOCOL_VERSION,
  fieldPackSchema,
  type FieldPack,
  type FieldPackResponse,
  type PackAssignment,
} from "@eia/field-sync-contract";
import { and, eq, sql } from "drizzle-orm";

import { withFieldContext } from "./context";
import { loadSurveyQuestions } from "./read-models";

/**
 * Everything one technician needs to work with no network, and nothing else.
 *
 * ## What "and nothing else" means here
 *
 * The temptation with an offline client is to ship it the project, because then every future
 * screen already has its data. That is how a phone in a truck ends up holding a consultancy's
 * whole social study. This builder reads **the caller's own assignments in the current campaign**,
 * the published questionnaire those assignments name, and the parcel context needed to find a
 * parcel — a code, a chainage, a side. It never reads another technician's work, another
 * project's anything, a response, a coding, a finding, a document or a geometry.
 *
 * ## Why it goes through the ordinary doors
 *
 * `requireCapability`, `requirePermission` and `withFieldContext` — the same three the web app's
 * own screens use. The row-level policies then apply `field.assignments.read_own` on top, so a
 * technician's pack is bounded by the database as well as by this query. Nothing here opens a
 * privileged connection or sets a context the caller did not earn.
 */
export interface FieldPackOptions {
  /** The authenticated session's expiry. The offline window can never outlive it. */
  readonly sessionExpiresAt: Date;
  /**
   * Who the session says is asking. Taken from the identity layer by the caller rather than from
   * `RequestContext`, which carries a user *id* and deliberately no profile.
   */
  readonly technician: { readonly email: string; readonly name: string | null };
  readonly now?: Date;
}

export async function buildFieldPack(
  db: Database,
  ctx: RequestContext,
  options: FieldPackOptions,
): Promise<FieldPackResponse> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.assignments.read_own");
  requirePermission(ctx, "field.capture");
  if (ctx.projectId === null) throw new Error("buildFieldPack requires a project context");
  const projectId = ctx.projectId;
  const now = options.now ?? new Date();

  return withFieldContext(db, ctx, async (tx) => {
    const project = await readProject(tx, ctx, projectId);

    const campaignRows = await tx.execute(sql`
      select c.id, c.name, c.status, c.capture_channel, c.offline_mode_at_activation,
             v.id as version_id, v.version_label, v.status as version_status,
             t.name as template_name
        from app.survey_campaign c
        join app.survey_version v on v.tenant_id = c.tenant_id and v.id = c.survey_version_id
        join app.survey_template t on t.tenant_id = v.tenant_id and t.id = v.template_id
       where c.tenant_id = ${ctx.tenantId} and c.project_id = ${projectId} and c.status = 'ACTIVE'
       order by c.activated_at desc nulls last
       limit 1
    `);
    const campaign = campaignRows.rows[0] as
      | {
          id: string;
          name: string;
          status: "ACTIVE";
          capture_channel: string;
          offline_mode_at_activation: "disabled" | "optional" | "required" | null;
          version_id: string;
          version_label: string;
          version_status: string;
          template_name: string;
        }
      | undefined;
    if (!campaign) {
      return {
        kind: "no_work",
        reason: "no_active_campaign",
        message:
          "Este proyecto no tiene una campaña en campo ahora mismo. Cuando la coordinación " +
          "active una, tu trabajo aparecerá aquí.",
      };
    }
    if (campaign.version_status !== "PUBLISHED") {
      // Not reachable through the product — activation refuses it — but a pack built against a
      // draft questionnaire would collect answers to questions that can still change.
      throw new Error("active campaign names a questionnaire that is not published");
    }

    const assignments = await readAssignmentsForPull(
      tx,
      ctx,
      projectId,
      campaign.id,
      campaign.version_id,
    );
    if (assignments.length === 0) {
      return {
        kind: "no_work",
        reason: "no_assignments",
        message:
          "No tienes predios asignados en la campaña actual. Habla con la coordinación del " +
          "proyecto si crees que debería haberlos.",
      };
    }

    const questions = await loadSurveyQuestions(tx, ctx, campaign.version_id);
    const window = deriveOfflineWindow({ now, sessionExpiresAt: options.sessionExpiresAt });

    const pack: FieldPack = {
      schemaVersion: FIELD_PACK_SCHEMA_VERSION,
      protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
      technician: {
        userId: ctx.userId,
        email: options.technician.email,
        name: options.technician.name,
      },
      project,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        captureChannel: campaign.capture_channel,
        // What the project required when the campaign was activated, recorded then and
        // never re-derived: a policy change afterwards does not rewrite what was in force.
        offlineMode: campaign.offline_mode_at_activation ?? "disabled",
        surveyVersion: {
          id: campaign.version_id,
          versionLabel: campaign.version_label,
          templateName: campaign.template_name,
          status: "PUBLISHED",
          questions: questions.map((question) => ({
            code: question.code,
            ordinal: question.ordinal,
            type: question.type,
            prompt: question.prompt,
            helpText: question.helpText,
            required: question.required,
            sensitivity: question.sensitivity,
            options: question.options.map((option) => ({
              code: option.code,
              label: option.label,
              ordinal: option.ordinal,
            })),
          })),
        },
      },
      assignments: [...assignments],
      validity: {
        issuedAt: window.issuedAt.toISOString(),
        expiresAt: window.expiresAt.toISOString(),
        basis: window.basis,
      },
      cursor: encodeCursor(now),
    };

    // Parsed on the way out, not only on the way in: a pack that does not satisfy its own contract
    // is a bug we would otherwise discover on a phone in a valley.
    return { kind: "pack", pack: fieldPackSchema.parse(pack) };
  });
}

async function readProject(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
): Promise<FieldPack["project"]> {
  const rows = await tx
    .select({
      projectSlug: appSchema.project.slug,
      projectName: appSchema.project.name,
      locality: appSchema.project.locationLabel,
      tenantSlug: appSchema.tenant.slug,
      tenantName: appSchema.tenant.name,
    })
    .from(appSchema.project)
    .innerJoin(appSchema.tenant, eq(appSchema.tenant.id, appSchema.project.tenantId))
    .where(and(eq(appSchema.project.tenantId, ctx.tenantId), eq(appSchema.project.id, projectId)));
  const row = rows[0];
  if (!row) throw new Error("project not visible in context");
  return {
    tenantId: ctx.tenantId,
    tenantSlug: row.tenantSlug,
    tenantName: row.tenantName,
    projectId,
    projectSlug: row.projectSlug,
    projectName: row.projectName,
    locality: row.locality,
  };
}

/**
 * The caller's own assignments, and the server state each one is already in.
 *
 * `openVisitId` and `instanceId` matter more than they look: a technician who reinstalls the app,
 * or who syncs from a second device, must not start a second visit or a second response for work
 * the server already holds. Handing the device the ids it would otherwise invent is what makes the
 * first sync after a reinstall a no-op rather than a duplicate.
 */
export async function readAssignmentsForPull(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  campaignId: string,
  versionId: string,
): Promise<ReadonlyArray<PackAssignment>> {
  const rows = await tx.execute(sql`
    select fa.id,
           fa.status,
           p.id as parcel_id,
           p.parcel_code,
           p.sector_label,
           p.chainage_m,
           p.side,
           open_visit.id as open_visit_id,
           si.id as instance_id,
           si.status as instance_status,
           extract(epoch from greatest(
             fa.assigned_at,
             coalesce(fa.completed_at, fa.assigned_at),
             coalesce(fa.cancelled_at, fa.assigned_at),
             coalesce(si.started_at, fa.assigned_at),
             coalesce(si.submitted_at, fa.assigned_at),
             coalesce(open_visit.started_at, fa.assigned_at)
           ))::bigint as revision
      from app.field_assignment fa
      join app.parcel p on p.tenant_id = fa.tenant_id and p.id = fa.parcel_id
      left join lateral (
        select fv.id, fv.started_at
          from app.field_visit fv
         where fv.tenant_id = fa.tenant_id and fv.assignment_id = fa.id
           and fv.status = 'IN_PROGRESS'
         order by fv.started_at desc
         limit 1
      ) open_visit on true
      left join app.survey_instance si
        on si.tenant_id = fa.tenant_id and si.assignment_id = fa.id
       and si.survey_version_id = ${versionId}
     where fa.tenant_id = ${ctx.tenantId}
       and fa.project_id = ${projectId}
       and fa.campaign_id = ${campaignId}
       and fa.assignee_user_id = ${ctx.userId}
       and fa.status <> 'CANCELLED'
     order by p.chainage_m nulls last, p.parcel_code
  `);

  return (
    rows.rows as unknown as ReadonlyArray<{
      id: string;
      status: AssignmentStatus;
      parcel_id: string;
      parcel_code: string;
      sector_label: string | null;
      chainage_m: string | null;
      side: ParcelSide;
      open_visit_id: string | null;
      instance_id: string | null;
      instance_status: InstanceStatus | null;
      revision: string | number;
    }>
  ).map((row) => ({
    id: row.id,
    status: row.status,
    parcel: {
      parcelId: row.parcel_id,
      parcelCode: row.parcel_code,
      sectorLabel: row.sector_label,
      chainageLabel: row.chainage_m === null ? null : formatChainage(Number(row.chainage_m)),
      side: PARCEL_SIDE_LABEL[row.side] ?? null,
    },
    openVisitId: row.open_visit_id,
    instanceId: row.instance_id,
    instanceStatus: row.instance_status,
    revision: Number(row.revision),
  }));
}

/**
 * The pull cursor: the instant the server answered, in seconds.
 *
 * ## Why a pull returns the whole assignment set rather than a diff
 *
 * The obvious design is an incremental change feed. It is the wrong one here, and the reason is
 * the size of the thing being synchronised: a pull is scoped to **one technician's assignments in
 * one campaign** — twelve in this pilot, a few dozen at worst — not to a project. A diff over a
 * set that small buys nothing and introduces the one failure an offline client cannot recover
 * from, a change that fell between two cursors and is never seen again. The field tables also
 * carry no `updated_at`, so a timestamp diff would have to be derived from workflow timestamps and
 * would silently miss a reassignment, which is precisely the change that matters most.
 *
 * So the pull answers with the current set and the ids that are no longer the caller's, which is
 * self-correcting by construction. The cursor stays in the protocol — opaque, and recording when
 * the device last heard from the server — so that a future incremental pull can change what it
 * encodes without a protocol version bump, and so the device can show *última sincronización*.
 */
export function encodeCursor(at: Date): string {
  return `t${Math.floor(at.getTime() / 1000)}`;
}

export function decodeCursor(cursor: string | null): Date | null {
  if (!cursor) return null;
  const match = /^t(\d{1,12})$/.exec(cursor);
  if (!match) return null;
  return new Date(Number(match[1]) * 1000);
}
