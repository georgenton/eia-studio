import { appSchema, fieldSchema, withDbContext, type Database } from "@eia/db";
import {
  CAPABILITY_KEYS,
  evaluateReadiness,
  FIELD_OFFLINE_MODE_KEY,
  getSystemProfile,
  InvalidInput,
  parseFieldOfflineMode,
  PermissionDenied,
  readFieldOfflineMode,
  requirePermission,
  type CapabilityKey,
  type CaptureChannel,
  type FieldOfflineMode,
  type ReadinessReport,
  type RequestContext,
} from "@eia/domain";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../audit/record";

/**
 * *Preparar proyecto* — the eight stages that make a project operable, read in one transaction.
 *
 * ## Why this is a read model and not a workflow engine
 *
 * The brief's word is *guided*, not *generic*. There is no stage table, no transition graph and no
 * persisted wizard position: a stage is a section of one page, and what it shows is the project as
 * it is right now. A stage the reader skipped is not a state — it is simply a part of the project
 * they have not filled in, and the readiness report is what says so. An engine would have given us
 * a second source of truth about a project that the project itself already answers.
 *
 * ## Why it is one transaction
 *
 * Readiness is a function of a *consistent* picture (see `evaluateReadiness`). Reading the
 * questionnaire in one transaction and the campaign in another would produce a report about a
 * project that never existed at any instant.
 */
export interface IntakeTeamMember {
  readonly membershipId: string;
  readonly role: string;
  /** Null when the identity carries no display name; the surface says so in its own words. */
  readonly displayName: string | null;
  readonly status: string;
}

export interface IntakeSurvey {
  readonly templateName: string;
  readonly versionLabel: string;
  readonly status: string;
  /** Locales this version was published in, canonical first (ADR-029). */
  readonly locales: ReadonlyArray<string>;
}

export interface IntakeDocument {
  readonly code: string;
  readonly title: string;
  readonly kind: string;
  readonly versionLabel: string;
  readonly versionCount: number;
  /** Where the current version's file has got to. Uploaded is not processed (ADR-031). */
  readonly processingState: string;
  /** What the uploader declared about personal data in it. Never something this product derived. */
  readonly privacyClassification: string;
}

export interface ProjectIntakeView {
  readonly project: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly officialTitle: string | null;
    readonly programmeReference: string | null;
    readonly locationLabel: string | null;
    readonly profileKey: string;
    readonly profileVersion: string;
    readonly lifecycle: string;
  };
  readonly team: ReadonlyArray<IntakeTeamMember>;
  readonly cartography: {
    readonly activeDatasets: number;
    readonly parcelsWithGeometry: number;
  };
  readonly documents: ReadonlyArray<IntakeDocument>;
  readonly surveys: ReadonlyArray<IntakeSurvey>;
  readonly profile: {
    readonly key: string;
    readonly enabled: ReadonlyArray<CapabilityKey>;
    readonly disabled: ReadonlyArray<CapabilityKey>;
    readonly territorialUnitKind: string;
  } | null;
  readonly offlineMode: FieldOfflineMode;
  readonly campaign: {
    readonly captureChannel: CaptureChannel | null;
    readonly status: string | null;
  };
  readonly readiness: ReadinessReport;
  /** Whether this caller may change anything here, resolved once for the surface. */
  readonly editable: boolean;
}

/**
 * Whether this deployment can store a file, as the caller already resolved it.
 *
 * Passed in rather than read here, because `resolveStorageAvailability` reads the environment and
 * the application layer does not (ARCHITECTURE §9.1): the web app resolves it once at startup and
 * the worker would resolve its own. Omitted, the readiness report treats storage as available —
 * which is what a caller that never stores a file is entitled to assume.
 */
export interface StorageReadiness {
  readonly available: boolean;
  /** `NOT_CONFIGURED`, `MEMORY_REFUSED_IN_PERSISTENT_ENVIRONMENT`, `BLOCKED_EXTERNAL_CONFIG`. */
  readonly reason: string | null;
}

export async function loadProjectIntake(
  db: Database,
  ctx: RequestContext,
  storage: StorageReadiness = { available: true, reason: null },
): Promise<ProjectIntakeView> {
  requirePermission(ctx, "project.intake.read");
  const projectId = requireProject(ctx);

  return withDbContext(db, ctx, async (tx) => {
    const [project] = await tx
      .select({
        id: appSchema.project.id,
        slug: appSchema.project.slug,
        name: appSchema.project.name,
        officialTitle: appSchema.project.officialTitle,
        programmeReference: appSchema.project.programmeReference,
        locationLabel: appSchema.project.locationLabel,
        profileKey: appSchema.project.profileKey,
        profileVersion: appSchema.project.profileVersion,
        lifecycle: appSchema.project.lifecycle,
      })
      .from(appSchema.project)
      .where(eq(appSchema.project.id, projectId));
    if (!project) throw new InvalidInput("project not found in this context");

    // The team, by role. A *suspended* membership is not a person on the project, so the readiness
    // rule counts only active ones — but the list shows both, because "who used to be here" is
    // something a coordinator reading this page wants to see.
    const team = await tx
      .select({
        membershipId: appSchema.projectMembership.id,
        role: appSchema.projectMembership.role,
        status: appSchema.projectMembership.status,
        displayName: appSchema.user.name,
        email: appSchema.user.email,
      })
      .from(appSchema.projectMembership)
      .innerJoin(
        appSchema.tenantMembership,
        eq(appSchema.projectMembership.tenantMembershipId, appSchema.tenantMembership.id),
      )
      .innerJoin(appSchema.user, eq(appSchema.tenantMembership.userId, appSchema.user.id))
      .where(eq(appSchema.projectMembership.projectId, projectId))
      .orderBy(asc(appSchema.projectMembership.role));

    const [cartography] = await tx
      .execute<{ datasets: number; parcels: number }>(
        sql`
      select
        (select count(distinct v.id)::int
           from app.spatial_dataset_version v
          where v.project_id = ${projectId} and v.is_active) as datasets,
        (select count(distinct g.parcel_id)::int
           from app.parcel_geometry g
          where g.project_id = ${projectId} and g.is_active) as parcels
    `,
      )
      .then((r) => r.rows);

    const documents = await tx.execute<{
      code: string;
      title: string;
      kind: string;
      version_label: string;
      version_count: number;
      processing_state: string | null;
      privacy_classification: string | null;
    }>(sql`
      select d.code, d.title, d.kind::text as kind,
             (array_agg(v.version_label order by v.created_at desc))[1] as version_label,
             count(v.id)::int as version_count,
             (array_agg(v.processing_state::text order by v.created_at desc))[1]
               as processing_state,
             (array_agg(v.privacy_classification::text order by v.created_at desc))[1]
               as privacy_classification
        from app.source_document d
        left join app.document_version v on v.document_id = d.id
       where d.project_id = ${projectId}
       group by d.id, d.code, d.title, d.kind
       order by d.code
    `);

    // Questionnaires, with the languages each version carries. The locales come from the
    // translation rows, so a version published only in Spanish reports exactly that.
    const surveys = await tx.execute<{
      template_name: string;
      version_label: string;
      status: string;
      locales: string[] | null;
    }>(sql`
      select t.name as template_name, v.version_label, v.status::text as status,
             (select array_agg(distinct tr.locale order by tr.locale)
                from app.survey_question_translation tr
                join app.survey_question q on q.id = tr.question_id
               where q.version_id = v.id) as locales
        from app.survey_version v
        join app.survey_template t on t.id = v.template_id
       where v.project_id = ${projectId}
       order by t.name, v.version_label
    `);

    const [campaign] = await tx
      .select({
        captureChannel: fieldSchema.surveyCampaign.captureChannel,
        status: fieldSchema.surveyCampaign.status,
      })
      .from(fieldSchema.surveyCampaign)
      .where(eq(fieldSchema.surveyCampaign.projectId, projectId))
      .orderBy(
        sql`coalesce(${fieldSchema.surveyCampaign.activatedAt}, ${fieldSchema.surveyCampaign.createdAt}) desc`,
      )
      .limit(1);

    const [configuration] = await tx
      .select({ value: fieldSchema.projectConfiguration.value })
      .from(fieldSchema.projectConfiguration)
      .where(
        and(
          eq(fieldSchema.projectConfiguration.projectId, projectId),
          eq(fieldSchema.projectConfiguration.key, FIELD_OFFLINE_MODE_KEY),
        ),
      );
    const offlineMode = readFieldOfflineMode(configuration?.value ?? null);

    const profile = getSystemProfile(project.profileKey);
    const capabilities = Object.fromEntries(
      CAPABILITY_KEYS.map((key) => [key, ctx.capabilities[key] === true]),
    ) as Record<CapabilityKey, boolean>;

    const readiness = evaluateReadiness({
      project: {
        name: project.name,
        officialTitle: project.officialTitle,
        locationLabel: project.locationLabel,
        lifecycle: project.lifecycle,
      },
      roles: team.filter((m) => m.status === "active").map((m) => m.role),
      capabilities,
      cartography: {
        activeDatasets: cartography?.datasets ?? 0,
        parcelsWithGeometry: cartography?.parcels ?? 0,
      },
      questionnaire: {
        publishedVersions: surveys.rows.filter((r) => r.status === "PUBLISHED").length,
        draftVersions: surveys.rows.filter((r) => r.status !== "PUBLISHED").length,
      },
      campaign: {
        captureChannel: (campaign?.captureChannel as CaptureChannel | undefined) ?? null,
        status: campaign?.status ?? null,
      },
      offlineMode,
      corpus: { documents: documents.rows.length },
      storage,
    });

    return {
      project,
      team: team.map((m) => ({
        membershipId: m.membershipId,
        role: m.role,
        status: m.status,
        // A display name, never an email: this page is read by people preparing a project, and an
        // address is contact data they have no reason to be handed here.
        displayName: m.displayName,
      })),
      cartography: {
        activeDatasets: cartography?.datasets ?? 0,
        parcelsWithGeometry: cartography?.parcels ?? 0,
      },
      documents: documents.rows.map((row) => ({
        code: row.code,
        title: row.title,
        kind: row.kind,
        versionLabel: row.version_label ?? "",
        versionCount: row.version_count,
        // A document with no version at all reports the state of nothing, which is what an empty
        // string says; the stage renders the row as having no file rather than inventing one.
        processingState: row.processing_state ?? "",
        privacyClassification: row.privacy_classification ?? "",
      })),
      surveys: surveys.rows.map((row) => ({
        templateName: row.template_name,
        versionLabel: row.version_label,
        status: row.status,
        locales: ["es-EC", ...(row.locales ?? [])],
      })),
      profile: profile
        ? {
            key: profile.key,
            enabled: profile.capabilities.enabled,
            disabled: profile.capabilities.disabled,
            territorialUnitKind: profile.territorialModel.unitKind,
          }
        : null,
      offlineMode,
      campaign: {
        captureChannel: (campaign?.captureChannel as CaptureChannel | undefined) ?? null,
        status: campaign?.status ?? null,
      },
      readiness,
      editable: ctx.permissions.has("project.intake.write"),
    };
  });
}

export const updateProjectIntakeInputSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    officialTitle: z.string().trim().max(400).nullable(),
    programmeReference: z.string().trim().max(120).nullable(),
    locationLabel: z.string().trim().max(160).nullable(),
    offlineMode: z.string().min(1),
  })
  .strict();

/**
 * Fill in what the product needs to operate the project.
 *
 * Deliberately **not** `project.configure`: that key is the write side of the capability resolver,
 * and turning a module off hides routes for everybody on the project. This writes the study's own
 * identity and the settings under modules that are already on (ADR-030).
 */
export async function updateProjectIntake(
  db: Database,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, "project.intake.write");
  const projectId = requireProject(ctx);
  const parsed = updateProjectIntakeInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new InvalidInput(parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;
  // Parsed by the registry's own schema: writing an invalid setting is a real error and throws.
  const offlineMode = parseFieldOfflineMode(input.offlineMode);

  await withDbContext(db, ctx, async (tx) => {
    await tx
      .update(appSchema.project)
      .set({
        name: input.name,
        officialTitle: emptyToNull(input.officialTitle),
        programmeReference: emptyToNull(input.programmeReference),
        locationLabel: emptyToNull(input.locationLabel),
      })
      .where(eq(appSchema.project.id, projectId));

    await tx
      .insert(fieldSchema.projectConfiguration)
      .values({
        id: randomUUID(),
        tenantId: ctx.tenantId,
        projectId,
        key: FIELD_OFFLINE_MODE_KEY,
        value: offlineMode,
        changedBy: ctx.userId,
      })
      .onConflictDoUpdate({
        target: [
          fieldSchema.projectConfiguration.tenantId,
          fieldSchema.projectConfiguration.projectId,
          fieldSchema.projectConfiguration.key,
        ],
        set: { value: offlineMode, changedBy: ctx.userId, changedAt: sql`now()` },
      });

    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "project.intake.updated",
        objectKind: "project",
        objectId: projectId,
        // The values, not the prose: an audit line records what changed, and the project's own
        // title is not something to copy into a second place that can drift from it.
        details: { offlineMode, hasOfficialTitle: input.officialTitle !== null },
      },
    );
  });
}

/**
 * Move the project from planning into field work.
 *
 * It changes **one column**. It activates no campaign, assigns no work and publishes nothing: a
 * lifecycle that silently did those things would be a button whose blast radius nobody could read
 * off the screen. What it does do is refuse while a required readiness rule is unmet — the same
 * report the surface shows, recomputed here so the decision is made on the server's picture rather
 * than on whatever the browser last rendered.
 */
export async function activateProject(
  db: Database,
  ctx: RequestContext,
  storage?: StorageReadiness,
): Promise<{ lifecycle: string; blocked: ReadonlyArray<string> }> {
  requirePermission(ctx, "project.intake.write");
  const projectId = requireProject(ctx);
  const view = await loadProjectIntake(db, ctx, storage);
  if (!view.readiness.operable) {
    return { lifecycle: view.project.lifecycle, blocked: view.readiness.blocking };
  }
  if (view.project.lifecycle !== "planning") {
    return { lifecycle: view.project.lifecycle, blocked: [] };
  }

  await withDbContext(db, ctx, async (tx) => {
    await tx
      .update(appSchema.project)
      .set({ lifecycle: "field" })
      .where(and(eq(appSchema.project.id, projectId), eq(appSchema.project.lifecycle, "planning")));
    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "project.activated",
        objectKind: "project",
        objectId: projectId,
        details: { from: "planning", to: "field" },
      },
    );
  });
  return { lifecycle: "field", blocked: [] };
}

function requireProject(ctx: RequestContext): string {
  if (ctx.projectId === null) {
    throw new PermissionDenied({ role: ctx.tenantRole, restrictedData: "project" });
  }
  return ctx.projectId;
}

function emptyToNull(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value.trim();
}
