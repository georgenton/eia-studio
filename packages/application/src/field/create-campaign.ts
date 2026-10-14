import { appSchema, fieldSchema, type Database } from "@eia/db";
import {
  NotFound,
  requireCapability,
  requirePermission,
  InvalidInput,
  type RequestContext,
} from "@eia/domain";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { recordAudit } from "../audit/record";
import { withFieldContext } from "./context";
import { lockProjectForOperationChange } from "./project-operation-lock";

/**
 * Opening the operation that field work belongs to.
 *
 * Everything around this already existed — a questionnaire is written and published in *Preparar
 * proyecto*, parcels are assigned with `assignParcel`, a campaign is activated with
 * `activateCampaign`, and a phone downloads `buildFieldPack` — and a campaign could still only
 * come from the demonstration seeder. So a project with real cartography and a real questionnaire
 * had no way to reach a technician's phone at all, which is the gap this closes and the whole of
 * what it does.
 *
 * It creates a **DRAFT** and nothing else. Activation stays where it is, with its own checks about
 * published versions, assignments and the offline policy; duplicating any of that here would give
 * the product two answers to the same question.
 */
export const createSurveyCampaignInputSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    surveyVersionId: z.string().uuid(),
    captureChannel: z.enum(["NATIVE_WEB", "EIA_FIELD_MOBILE"]),
    /** Optional, and only meaningful together: a plan cannot end before it starts. */
    startsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    targetOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
  })
  .strict()
  .refine((v) => v.startsOn === null || v.targetOn === null || v.startsOn <= v.targetOn, {
    message: "targetOn must not be before startsOn",
    path: ["targetOn"],
  });

export type CreateSurveyCampaignInput = z.input<typeof createSurveyCampaignInputSchema>;

export interface CreatedSurveyCampaign {
  readonly campaignId: string;
  readonly name: string;
  readonly status: "DRAFT";
  readonly surveyVersionId: string;
  readonly surveyVersionLabel: string;
  readonly captureChannel: "NATIVE_WEB" | "EIA_FIELD_MOBILE";
  /** True when an identical draft already existed and was returned instead of a second one. */
  readonly reused: boolean;
}

export async function createSurveyCampaign(
  db: Database,
  ctx: RequestContext,
  raw: CreateSurveyCampaignInput,
): Promise<CreatedSurveyCampaign> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.campaigns.manage");
  if (ctx.projectId === null) throw new Error("createSurveyCampaign requires a project context");
  const projectId = ctx.projectId;
  const input = createSurveyCampaignInputSchema.parse(raw);

  return withFieldContext(db, ctx, async (tx) => {
    // Before anything is read: two simultaneous submits would otherwise both find no draft.
    await lockProjectForOperationChange(tx, ctx.tenantId, projectId);

    /*
     * The version must be this project's and must be PUBLISHED. A DRAFT can still change under
     * the campaign's feet, and a RETIRED one was deliberately taken out of use; either would mean
     * households answering a questionnaire nobody decided they would be asked (ADR-037). RLS has
     * already narrowed this to the caller's tenant, and `project_id` is checked here too, so a
     * version id copied from another project of the same firm is `NotFound` rather than a surprise.
     */
    const found = await tx
      .select({
        id: fieldSchema.surveyVersion.id,
        label: fieldSchema.surveyVersion.versionLabel,
        status: fieldSchema.surveyVersion.status,
      })
      .from(fieldSchema.surveyVersion)
      .where(
        and(
          eq(fieldSchema.surveyVersion.tenantId, ctx.tenantId),
          eq(fieldSchema.surveyVersion.projectId, projectId),
          eq(fieldSchema.surveyVersion.id, input.surveyVersionId),
        ),
      )
      .limit(1);
    const version = found[0];
    if (version === undefined) throw new NotFound("survey version");
    if (version.status !== "PUBLISHED") {
      throw new InvalidInput(
        `a campaign may only be opened against a published questionnaire; this one is ${version.status}`,
      );
    }

    /*
     * A double submit is a person clicking twice, not a second operation. An identical DRAFT —
     * same name, same version, same channel — is returned rather than duplicated. This is
     * deliberately narrow: it does not touch a campaign that has been activated or closed, and it
     * does not merge two drafts somebody meant to keep apart.
     */
    const existing = await tx
      .select({
        id: fieldSchema.surveyCampaign.id,
        startsOn: fieldSchema.surveyCampaign.startsOn,
        targetOn: fieldSchema.surveyCampaign.targetOn,
      })
      .from(fieldSchema.surveyCampaign)
      .where(
        and(
          eq(fieldSchema.surveyCampaign.tenantId, ctx.tenantId),
          eq(fieldSchema.surveyCampaign.projectId, projectId),
          eq(fieldSchema.surveyCampaign.status, "DRAFT"),
          eq(fieldSchema.surveyCampaign.name, input.name),
          eq(fieldSchema.surveyCampaign.surveyVersionId, input.surveyVersionId),
          eq(fieldSchema.surveyCampaign.captureChannel, input.captureChannel),
        ),
      )
      .limit(1);
    const prior = existing[0];
    if (prior !== undefined) {
      /*
       * Same name, same questionnaire, same channel — but the dates were not part of that
       * comparison, and two requests whose planned dates differ are not the same request. Handing
       * back the first draft would quietly give the caller a campaign planned for days they did
       * not ask for; creating a second would leave the project two campaigns with one name. So it
       * is a refusal that says what the existing one is planned for, and the person decides.
       */
      if (prior.startsOn !== input.startsOn || prior.targetOn !== input.targetOn) {
        throw new InvalidInput(
          `a draft campaign named «${input.name}» already exists for this questionnaire, planned ` +
            `${prior.startsOn ?? "sin inicio"} → ${prior.targetOn ?? "sin cierre"}. Change its ` +
            `dates on that campaign, or open this one under a different name.`,
        );
      }
      return {
        campaignId: prior.id,
        name: input.name,
        status: "DRAFT" as const,
        surveyVersionId: input.surveyVersionId,
        surveyVersionLabel: version.label,
        captureChannel: input.captureChannel,
        reused: true,
      };
    }

    const provenanceId = randomUUID();
    await tx.insert(appSchema.provenanceRecord).values({
      id: provenanceId,
      tenantId: ctx.tenantId,
      projectId,
      // A real operation this firm is opening, not a demonstration: `DEMO_SIMULATION` here would
      // mark every visit and answer that follows as simulated (invariant 4).
      regime: "LIVE_OPERATIONAL",
      origin: "SYSTEM_GENERATED",
      transformations: ["ORIGINAL"],
      granularity: "AGGREGATE",
      title: "Campaña de campo abierta en el producto",
      note: "La campaña como operación. No contiene respuestas ni datos de ningún predio.",
      method: "Creación manual de la campaña en Trabajo de campo.",
      capturedAt: new Date(),
      validationState: "NOT_REQUIRED",
    });

    const campaignId = randomUUID();
    await tx.insert(fieldSchema.surveyCampaign).values({
      id: campaignId,
      tenantId: ctx.tenantId,
      projectId,
      name: input.name,
      surveyVersionId: input.surveyVersionId,
      // Always DRAFT. Activation is a separate decision with separate checks.
      status: "DRAFT",
      captureChannel: input.captureChannel,
      // The offline policy is read and recorded when the campaign is activated (ADR-018), because
      // that is when it binds; writing it now would freeze a setting nobody has acted on.
      offlineModeAtActivation: null,
      startsOn: input.startsOn,
      targetOn: input.targetOn,
      createdBy: ctx.userId,
      provenanceId,
    });

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "field.campaign.created",
        objectKind: "survey_campaign",
        objectId: campaignId,
        // The operation and the instrument it asks. No parcel, no technician, no answer.
        details: {
          captureChannel: input.captureChannel,
          surveyVersionLabel: version.label,
        },
      },
    );

    return {
      campaignId,
      name: input.name,
      status: "DRAFT" as const,
      surveyVersionId: input.surveyVersionId,
      surveyVersionLabel: version.label,
      captureChannel: input.captureChannel,
      reused: false,
    };
  });
}

/** Published versions of this project, for the surface that opens a campaign. */
export async function listPublishableSurveyVersions(
  db: Database,
  ctx: RequestContext,
): Promise<ReadonlyArray<{ id: string; label: string; templateName: string }>> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.read");
  if (ctx.projectId === null) throw new Error("listPublishableSurveyVersions requires a project");
  const projectId = ctx.projectId;
  return withFieldContext(db, ctx, async (tx) => {
    const rows = await tx.execute<{ id: string; label: string; template_name: string }>(
      sql`select v.id, v.version_label as label, t.name as template_name
            from app.survey_version v
            join app.survey_template t on t.tenant_id = v.tenant_id and t.id = v.template_id
           where v.tenant_id = ${ctx.tenantId} and v.project_id = ${projectId}
             and v.status = 'PUBLISHED'
           order by t.name, v.version_label`,
    );
    return (rows.rows ?? []).map((r) => ({
      id: r.id,
      label: r.label,
      templateName: r.template_name,
    }));
  });
}
