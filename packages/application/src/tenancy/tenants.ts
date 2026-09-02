import { randomUUID } from "node:crypto";

import { appSchema, withDbContext, type Database } from "@eia/db";
import {
  CAPABILITY_CATALOG,
  CAPABILITY_KEYS,
  InvalidInput,
  requirePermission,
  RoleEscalation,
  TENANT_ROLE_RANK,
  TENANT_ROLES,
  type CapabilityKey,
  type RequestContext,
  type TenantRole,
} from "@eia/domain";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../audit/record";

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/, "invalid slug");

/** "Incluido" in the approved catalogue: every non-extension key. Entitlement source for new tenants. */
export const DEFAULT_PLAN_ENTITLEMENTS: ReadonlyArray<CapabilityKey> = CAPABILITY_KEYS.filter(
  (key) => CAPABILITY_CATALOG[key].productStatus !== "EXTENSION",
);

export const createTenantInputSchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(2).max(120),
  })
  .strict();

export interface CreateTenantResult {
  readonly tenantId: string;
  readonly membershipId: string;
}

/**
 * Any authenticated user may create a tenant and becomes its OWNER. The transaction pre-assigns
 * the tenant id and runs with it as context so the RLS WITH CHECK policies accept the rows.
 */
export async function createTenant(
  db: Database,
  actor: { userId: string; requestId: string },
  rawInput: unknown,
  entitlements: ReadonlyArray<CapabilityKey> = DEFAULT_PLAN_ENTITLEMENTS,
): Promise<CreateTenantResult> {
  const parsed = createTenantInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new InvalidInput(parsed.error.issues.map((i) => i.message).join("; "));
  const input = parsed.data;
  const tenantId = randomUUID();
  const membershipId = randomUUID();
  await withDbContext(db, { userId: actor.userId, tenantId, projectId: null }, async (tx) => {
    await tx.insert(appSchema.tenant).values({ id: tenantId, slug: input.slug, name: input.name });
    await tx.insert(appSchema.tenantMembership).values({
      id: membershipId,
      tenantId,
      userId: actor.userId,
      role: "OWNER",
      status: "active",
    });
    if (entitlements.length > 0) {
      await tx.insert(appSchema.tenantCapability).values(
        entitlements.map((key) => ({
          tenantId,
          capabilityKey: key,
          entitled: true,
          enabled: true,
          changedBy: actor.userId,
        })),
      );
    }
    await recordAudit(
      tx,
      { tenantId, projectId: null },
      { userId: actor.userId, kind: "user", requestId: actor.requestId },
      {
        action: "tenant.created",
        objectKind: "tenant",
        objectId: tenantId,
        details: { slug: input.slug },
      },
    );
  });
  return { tenantId, membershipId };
}

export const addTenantMembershipInputSchema = z
  .object({ userId: z.uuid(), role: z.enum(TENANT_ROLES) })
  .strict();

function assertCanAssignTenantRole(ctx: RequestContext, role: TenantRole): void {
  if (TENANT_ROLE_RANK[role] > TENANT_ROLE_RANK[ctx.tenantRole]) {
    throw new RoleEscalation(`role ${ctx.tenantRole} cannot grant ${role}`);
  }
  if (role === "OWNER" && ctx.tenantRole !== "OWNER") {
    throw new RoleEscalation("only an OWNER can grant OWNER");
  }
}

export async function addTenantMembership(
  db: Database,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<{ membershipId: string }> {
  requirePermission(ctx, "members.manage");
  const parsed = addTenantMembershipInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new InvalidInput("invalid membership input");
  const input = parsed.data;
  assertCanAssignTenantRole(ctx, input.role);
  const membershipId = randomUUID();
  await withDbContext(db, ctx, async (tx) => {
    await tx.insert(appSchema.tenantMembership).values({
      id: membershipId,
      tenantId: ctx.tenantId,
      userId: input.userId,
      role: input.role,
      status: "active",
      invitedBy: ctx.userId,
    });
    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId: null },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "tenant.membership.added",
        objectKind: "tenant_membership",
        objectId: membershipId,
        details: { role: input.role },
      },
    );
  });
  return { membershipId };
}

export const changeTenantRoleInputSchema = z
  .object({ membershipId: z.uuid(), role: z.enum(TENANT_ROLES) })
  .strict();

/** Role changes are audited; the last OWNER can never be demoted (TENANCY.md §6). */
export async function changeTenantMembershipRole(
  db: Database,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, "roles.assign");
  const parsed = changeTenantRoleInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new InvalidInput("invalid role change input");
  const input = parsed.data;
  assertCanAssignTenantRole(ctx, input.role);
  await withDbContext(db, ctx, async (tx) => {
    const [target] = await tx
      .select({ role: appSchema.tenantMembership.role })
      .from(appSchema.tenantMembership)
      .where(
        and(
          eq(appSchema.tenantMembership.id, input.membershipId),
          eq(appSchema.tenantMembership.tenantId, ctx.tenantId),
        ),
      );
    if (!target) throw new InvalidInput("membership not found");
    if (TENANT_ROLE_RANK[target.role] > TENANT_ROLE_RANK[ctx.tenantRole]) {
      throw new RoleEscalation("cannot change the role of a higher-ranked member");
    }
    if (target.role === "OWNER" && input.role !== "OWNER") {
      const [owners] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(appSchema.tenantMembership)
        .where(
          and(
            eq(appSchema.tenantMembership.tenantId, ctx.tenantId),
            eq(appSchema.tenantMembership.role, "OWNER"),
            eq(appSchema.tenantMembership.status, "active"),
          ),
        );
      if ((owners?.n ?? 0) <= 1) throw new RoleEscalation("the last OWNER cannot be demoted");
    }
    await tx
      .update(appSchema.tenantMembership)
      .set({ role: input.role })
      .where(
        and(
          eq(appSchema.tenantMembership.id, input.membershipId),
          eq(appSchema.tenantMembership.tenantId, ctx.tenantId),
        ),
      );
    await recordAudit(
      tx,
      { tenantId: ctx.tenantId, projectId: null },
      { userId: ctx.userId, kind: "user", requestId: ctx.requestId },
      {
        action: "tenant.membership.role_changed",
        objectKind: "tenant_membership",
        objectId: input.membershipId,
        details: { from: target.role, to: input.role },
      },
    );
  });
}
