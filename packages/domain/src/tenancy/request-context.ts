import { randomUUID } from "node:crypto";

import { appSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import { and, eq } from "drizzle-orm";

import { recordAudit } from "../audit/index";
import { emptyCapabilitySet, resolveCapabilities } from "../core/capabilities/index";
import { freezeContext, type RequestContext } from "../core/context";
import { PermissionDenied } from "../core/errors";
import type { SessionUser } from "../core/identity-port";
import type { Permission } from "../core/permissions";
import {
  OWNER_IMPLICIT_PROJECT_PERMISSIONS,
  PROJECT_ROLE_PERMISSIONS,
  TENANT_ROLE_PERMISSIONS,
  type ProjectRole,
  type TenantRole,
} from "../core/roles";
import { loadProjectCapabilitySettings, loadTenantCapabilitySettings } from "./capability-settings";

export interface BuildRequestContextInput {
  readonly sessionUser: SessionUser;
  readonly tenantSlug: string;
  readonly projectSlug?: string | null;
  readonly requestId?: string;
  readonly locale?: string;
}

/**
 * Ensure the domain user row exists for the identity subject (first sign-in). Runs with only
 * app.user_id set; the RLS policy on app.user allows a user to see and insert their own row.
 */
export async function ensureUser(db: Database, sessionUser: SessionUser): Promise<void> {
  await withDbContext(
    db,
    { userId: sessionUser.subject, tenantId: null, projectId: null },
    async (tx) => {
      const existing = await tx
        .select({ id: appSchema.user.id })
        .from(appSchema.user)
        .where(eq(appSchema.user.id, sessionUser.subject));
      if (existing.length === 0) {
        await tx.insert(appSchema.user).values({
          id: sessionUser.subject,
          email: sessionUser.email,
          name: sessionUser.name,
        });
      }
    },
  );
}

interface TenantResolution {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly membershipId: string;
  readonly role: TenantRole;
}

async function resolveTenant(
  tx: DbTx,
  userId: string,
  tenantSlug: string,
): Promise<TenantResolution | null> {
  const rows = await tx
    .select({
      tenantId: appSchema.tenant.id,
      tenantSlug: appSchema.tenant.slug,
      membershipId: appSchema.tenantMembership.id,
      role: appSchema.tenantMembership.role,
    })
    .from(appSchema.tenant)
    .innerJoin(
      appSchema.tenantMembership,
      and(
        eq(appSchema.tenantMembership.tenantId, appSchema.tenant.id),
        eq(appSchema.tenantMembership.userId, userId),
        eq(appSchema.tenantMembership.status, "active"),
      ),
    )
    .where(and(eq(appSchema.tenant.slug, tenantSlug), eq(appSchema.tenant.status, "active")));
  return rows[0] ?? null;
}

/**
 * Build the immutable RequestContext from the authenticated subject and the URL context.
 * Every identifier is verified against memberships inside RLS-scoped transactions; a tenant or
 * project the user has no access to is indistinguishable from a non-existent one.
 */
export async function buildRequestContext(
  db: Database,
  input: BuildRequestContextInput,
): Promise<RequestContext> {
  const userId = input.sessionUser.subject;
  const requestId = input.requestId ?? randomUUID();
  const locale = input.locale ?? "es-EC";

  const tenant = await withDbContext(db, { userId, tenantId: null, projectId: null }, (tx) =>
    resolveTenant(tx, userId, input.tenantSlug),
  );
  if (!tenant) throw new PermissionDenied({ role: null, restrictedData: "tenant" });

  const tenantPermissions = TENANT_ROLE_PERMISSIONS[tenant.role];

  if (!input.projectSlug) {
    const capabilities = await withDbContext(
      db,
      { userId, tenantId: tenant.tenantId, projectId: null },
      async (tx) =>
        resolveCapabilities({ tenant: await loadTenantCapabilitySettings(tx, tenant.tenantId) }),
    );
    return freezeContext<RequestContext>({
      requestId,
      userId,
      tenantId: tenant.tenantId,
      tenantSlug: tenant.tenantSlug,
      tenantMembershipId: tenant.membershipId,
      tenantRole: tenant.role,
      projectId: null,
      projectSlug: null,
      projectMembershipId: null,
      projectRole: null,
      implicitOwnerProjectAccess: false,
      permissions: new Set<Permission>(tenantPermissions),
      capabilities,
      locale,
    });
  }

  const projectSlug = input.projectSlug;
  return withDbContext(db, { userId, tenantId: tenant.tenantId, projectId: null }, async (tx) => {
    // Project rows are visible to members and to tenant OWNER/ADMIN (administration); RLS
    // hides everything else, so a foreign or unassigned project yields "not found" → denied.
    const projects = await tx
      .select({ id: appSchema.project.id, slug: appSchema.project.slug })
      .from(appSchema.project)
      .where(
        and(
          eq(appSchema.project.tenantId, tenant.tenantId),
          eq(appSchema.project.slug, projectSlug),
        ),
      );
    const project = projects[0];
    if (!project) throw new PermissionDenied({ role: tenant.role, restrictedData: "project" });

    const memberships = await tx
      .select({ id: appSchema.projectMembership.id, role: appSchema.projectMembership.role })
      .from(appSchema.projectMembership)
      .where(
        and(
          eq(appSchema.projectMembership.tenantId, tenant.tenantId),
          eq(appSchema.projectMembership.projectId, project.id),
          eq(appSchema.projectMembership.tenantMembershipId, tenant.membershipId),
          eq(appSchema.projectMembership.status, "active"),
        ),
      );
    const membership = memberships[0];

    let projectRole: ProjectRole | null = null;
    let projectPermissions: ReadonlySet<Permission> = new Set();
    let implicitOwnerProjectAccess = false;

    if (membership) {
      projectRole = membership.role;
      projectPermissions = PROJECT_ROLE_PERMISSIONS[membership.role];
    } else if (tenant.role === "OWNER") {
      // D-015: OWNER implicit project access — computed, explicit and audited.
      implicitOwnerProjectAccess = true;
      projectPermissions = OWNER_IMPLICIT_PROJECT_PERMISSIONS;
      await recordAudit(
        tx,
        { tenantId: tenant.tenantId, projectId: project.id },
        { userId, kind: "user", requestId },
        { action: "access.owner_implicit_project", objectKind: "project", objectId: project.id },
      );
    } else if (tenant.role !== "ADMIN") {
      // MEMBER without assignment: no access at all.
      throw new PermissionDenied({ role: tenant.role, restrictedData: "project" });
    }
    // ADMIN without membership: administration only (tenant permissions), no project data.

    const tenantSettings = await loadTenantCapabilitySettings(tx, tenant.tenantId);
    const projectSettings = await loadProjectCapabilitySettings(tx, tenant.tenantId, project.id);
    const capabilities =
      projectRole || implicitOwnerProjectAccess || tenant.role === "ADMIN"
        ? resolveCapabilities({ tenant: tenantSettings, project: projectSettings })
        : emptyCapabilitySet();

    return freezeContext<RequestContext>({
      requestId,
      userId,
      tenantId: tenant.tenantId,
      tenantSlug: tenant.tenantSlug,
      tenantMembershipId: tenant.membershipId,
      tenantRole: tenant.role,
      projectId: project.id,
      projectSlug: project.slug,
      projectMembershipId: membership?.id ?? null,
      projectRole,
      implicitOwnerProjectAccess,
      permissions: new Set<Permission>([...tenantPermissions, ...projectPermissions]),
      capabilities,
      locale,
    });
  });
}

/** Tenants the user belongs to (for the tenant switcher / foundation page). */
export async function listUserTenants(
  db: Database,
  userId: string,
): Promise<ReadonlyArray<{ id: string; slug: string; name: string; role: TenantRole }>> {
  return withDbContext(db, { userId, tenantId: null, projectId: null }, (tx) =>
    tx
      .select({
        id: appSchema.tenant.id,
        slug: appSchema.tenant.slug,
        name: appSchema.tenant.name,
        role: appSchema.tenantMembership.role,
      })
      .from(appSchema.tenantMembership)
      .innerJoin(appSchema.tenant, eq(appSchema.tenant.id, appSchema.tenantMembership.tenantId))
      .where(
        and(
          eq(appSchema.tenantMembership.userId, userId),
          eq(appSchema.tenantMembership.status, "active"),
        ),
      ),
  );
}
