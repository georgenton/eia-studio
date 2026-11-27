import { randomUUID } from "node:crypto";

import { appSchema, withDbContext, type Database } from "@eia/db";
import {
  assertProjectOverrideAllowed,
  can,
  CAPABILITY_KEYS,
  getSystemProfile,
  InvalidInput,
  PermissionDenied,
  PROJECT_ROLES,
  requirePermission,
  type CapabilityKey,
  type RequestContext,
} from "@eia/domain";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../audit/record";
import { loadTenantCapabilitySettings } from "./capability-settings";
import { slugSchema } from "./tenants";

export const createProjectInputSchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(2).max(160),
    profileKey: z.string().min(1),
  })
  .strict();

/**
 * Create a project from a system profile (ADR-003 snapshot semantics). The project's capability
 * overrides are copied from the profile's disabled list; the tenant's entitlement is the ceiling.
 */
export async function createProject(
  db: Database,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<{ projectId: string }> {
  requirePermission(ctx, "projects.create");
  const parsed = createProjectInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new InvalidInput(parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;
  const profile = getSystemProfile(input.profileKey);
  if (!profile) throw new InvalidInput("unknown project profile");
  const projectId = randomUUID();
  await withDbContext(db, { userId: ctx.userId, tenantId: ctx.tenantId, projectId }, async (tx) => {
    await tx.insert(appSchema.project).values({
      id: projectId,
      tenantId: ctx.tenantId,
      slug: input.slug,
      name: input.name,
      profileKey: profile.key,
      profileVersion: String(profile.version),
    });
    // Profile defaults are NOT materialised as override rows: they are read from the profile
    // snapshot at resolution time, so the profile-default and explicit-override layers stay
    // distinguishable (IG0-H02). Only a deliberate project decision writes a row here.
    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "project.created",
        objectKind: "project",
        objectId: projectId,
        details: { slug: input.slug, profile: profile.key, profileVersion: profile.version },
      },
    );

    /*
     * The person who created it is its coordinator, written here and audited as the membership
     * change it is.
     *
     * Until this existed, *Nuevo proyecto* produced a project **nobody could open**. A tenant
     * ADMIN has no implicit access to project data — that is D-015 and it is right — so the
     * product created the project, redirected the creator to *Preparar proyecto*, and refused
     * them at the door: *Tu rol Administración no incluye Preparar proyecto*. Observed on
     * staging on 27 November 2026. With no surface anywhere that writes a `ProjectMembership`,
     * the only way out was an operator script.
     *
     * This is not an escalation. `projects.create` is held by OWNER and ADMIN only, both of which
     * already hold `project.members.manage`, so the creator could grant themselves this role the
     * moment a surface for it existed — and TENANCY §6's requirement is precisely that such a
     * grant be an **audited membership change** rather than an implicit one. It is both.
     *
     * An OWNER already reaches every project by computed access; the row is written for them too,
     * so "who is on this project" answers the same way however the project began.
     */
    const creatorMembership = await tx
      .select({ id: appSchema.tenantMembership.id })
      .from(appSchema.tenantMembership)
      .where(
        and(
          eq(appSchema.tenantMembership.tenantId, ctx.tenantId),
          eq(appSchema.tenantMembership.userId, ctx.userId),
        ),
      )
      .limit(1);
    if (creatorMembership[0]) {
      const membershipId = randomUUID();
      await tx.insert(appSchema.projectMembership).values({
        id: membershipId,
        tenantId: ctx.tenantId,
        projectId,
        tenantMembershipId: creatorMembership[0].id,
        role: "COORDINATOR",
        status: "active",
      });
      await recordAudit(
        tx,
        { tenantId: ctx.tenantId, projectId },
        { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
        {
          action: "project.membership.added",
          objectKind: "project_membership",
          objectId: membershipId,
          details: { role: "COORDINATOR", reason: "project.created" },
        },
      );
    }
  });
  return { projectId };
}

export const addProjectMembershipInputSchema = z
  .object({ tenantMembershipId: z.uuid(), role: z.enum(PROJECT_ROLES) })
  .strict();

/**
 * Requires `project.members.manage` either as a project permission (COORDINATOR) or as a tenant
 * permission (OWNER/ADMIN administration). The composite FKs guarantee the tenant membership
 * belongs to the project's tenant; a mismatch is rejected by the database, not just here.
 */
export async function addProjectMembership(
  db: Database,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<{ membershipId: string }> {
  if (ctx.projectId === null)
    throw new PermissionDenied({ role: ctx.tenantRole, restrictedData: "project" });
  if (!can(ctx, "project.members.manage")) {
    throw new PermissionDenied({
      role: ctx.projectRole ?? ctx.tenantRole,
      restrictedData: "project.members.manage",
    });
  }
  const parsed = addProjectMembershipInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new InvalidInput("invalid project membership input");
  const input = parsed.data;
  const membershipId = randomUUID();
  const projectId = ctx.projectId;
  await withDbContext(db, ctx, async (tx) => {
    await tx.insert(appSchema.projectMembership).values({
      id: membershipId,
      tenantId: ctx.tenantId,
      projectId,
      tenantMembershipId: input.tenantMembershipId,
      role: input.role,
      status: "active",
    });
    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "project.membership.added",
        objectKind: "project_membership",
        objectId: membershipId,
        details: { role: input.role },
      },
    );
  });
  return { membershipId };
}

export interface PortfolioProject {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly profileKey: string;
  readonly lifecycle: string;
}

/** Portfolio read model: projects the caller may see (RLS + explicit tenant predicate). */
export async function listPortfolio(
  db: Database,
  ctx: RequestContext,
): Promise<ReadonlyArray<PortfolioProject>> {
  requirePermission(ctx, "portfolio.read");
  return withDbContext(db, { userId: ctx.userId, tenantId: ctx.tenantId, projectId: null }, (tx) =>
    tx
      .select({
        id: appSchema.project.id,
        slug: appSchema.project.slug,
        name: appSchema.project.name,
        profileKey: appSchema.project.profileKey,
        lifecycle: appSchema.project.lifecycle,
      })
      .from(appSchema.project)
      .where(eq(appSchema.project.tenantId, ctx.tenantId))
      .orderBy(appSchema.project.createdAt),
  );
}

export const setTenantCapabilityInputSchema = z
  .object({ key: z.enum(CAPABILITY_KEYS), enabled: z.boolean(), entitled: z.boolean().optional() })
  .strict();

export async function setTenantCapability(
  db: Database,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, "modules.manage");
  const parsed = setTenantCapabilityInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new InvalidInput("invalid capability input");
  const input = parsed.data;
  await withDbContext(
    db,
    { userId: ctx.userId, tenantId: ctx.tenantId, projectId: null },
    async (tx) => {
      await tx
        .insert(appSchema.tenantCapability)
        .values({
          tenantId: ctx.tenantId,
          capabilityKey: input.key,
          entitled: input.entitled ?? false,
          enabled: input.enabled,
          changedBy: ctx.userId,
        })
        .onConflictDoUpdate({
          target: [appSchema.tenantCapability.tenantId, appSchema.tenantCapability.capabilityKey],
          set: {
            enabled: input.enabled,
            ...(input.entitled === undefined ? {} : { entitled: input.entitled }),
            changedBy: ctx.userId,
            changedAt: sql`now()`,
          },
        });
      await recordAudit(
        tx,
        { tenantId: ctx.tenantId, projectId: null },
        { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
        {
          action: "capability.tenant.changed",
          objectKind: "capability",
          objectId: input.key,
          details: { enabled: input.enabled, entitled: input.entitled ?? null },
        },
      );
    },
  );
}

export const setProjectCapabilityInputSchema = z
  .object({ key: z.enum(CAPABILITY_KEYS), enabled: z.boolean() })
  .strict();

/**
 * Explicit project decision for one capability. A project may enable or disable a capability the
 * product and tenant allow; enabling one they do not allow is rejected at write time and, even if
 * a row were forged, by the resolver's conjunction (IG0-H02).
 */
export async function setProjectCapability(
  db: Database,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<void> {
  if (ctx.projectId === null)
    throw new PermissionDenied({ role: ctx.tenantRole, restrictedData: "project" });
  if (!can(ctx, "project.configure") && !can(ctx, "modules.manage")) {
    throw new PermissionDenied({
      role: ctx.projectRole ?? ctx.tenantRole,
      restrictedData: "project.configure",
    });
  }
  const parsed = setProjectCapabilityInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new InvalidInput("invalid capability input");
  const input = parsed.data;
  const key: CapabilityKey = input.key;
  const projectId = ctx.projectId;
  await withDbContext(db, ctx, async (tx) => {
    const tenantSettings = await loadTenantCapabilitySettings(tx, ctx.tenantId);
    assertProjectOverrideAllowed(tenantSettings, key, input.enabled);
    await tx
      .insert(appSchema.projectCapabilitySetting)
      .values({
        tenantId: ctx.tenantId,
        projectId,
        capabilityKey: key,
        enabled: input.enabled,
        changedBy: ctx.userId,
      })
      .onConflictDoUpdate({
        target: [
          appSchema.projectCapabilitySetting.projectId,
          appSchema.projectCapabilitySetting.capabilityKey,
        ],
        set: { enabled: input.enabled, changedBy: ctx.userId, changedAt: sql`now()` },
      });
    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "capability.project.changed",
        objectKind: "capability",
        objectId: key,
        details: { enabled: input.enabled },
      },
    );
  });
}
