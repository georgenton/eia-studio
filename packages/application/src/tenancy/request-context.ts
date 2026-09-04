import { randomUUID } from "node:crypto";

import { adoptTenantContext, appSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import {
  emptyCapabilitySet,
  freezeContext,
  OWNER_IMPLICIT_PROJECT_PERMISSIONS,
  PermissionDenied,
  PROJECT_ROLE_PERMISSIONS,
  resolveCapabilities,
  TENANT_ROLE_PERMISSIONS,
  type Permission,
  type ProjectRole,
  type RequestContext,
  type SessionUser,
  type TenantCapabilitySettings,
  type TenantRole,
} from "@eia/domain";
import { and, eq } from "drizzle-orm";

import { recordAudit } from "../audit/record";
import {
  loadProjectCapabilityOverrides,
  loadTenantCapabilitySettings,
  projectProfileDefaults,
} from "./capability-settings";

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
  await withDbContext(db, { userId: sessionUser.subject, tenantId: null, projectId: null }, (tx) =>
    ensureUserRow(tx, sessionUser),
  );
}

/** The same reconciliation, inside a transaction the caller already opened. */
async function ensureUserRow(tx: DbTx, sessionUser: SessionUser): Promise<void> {
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
 * What one request needs to know before it may read anything, and the tenant rows the shell needs
 * to draw itself.
 *
 * The settings are returned rather than re-read. Resolving the project already loads them —
 * capabilities cannot be resolved without them — and a shell that asked again spent a whole
 * transaction re-reading rows the authorization path had just read (TD-064). They are *not* part
 * of `RequestContext`: they decide navigation presentation, never authorization, and the type that
 * carries authorization must not start carrying things that do not.
 */
export interface AccessContext {
  readonly ctx: RequestContext;
  readonly tenantSettings: TenantCapabilitySettings;
}

/**
 * Resolve the caller, in **one transaction** (TD-064).
 *
 * It used to be four: reconcile the user, resolve the tenant, resolve the project with its
 * memberships and overrides, and — from the shell — read the tenant's capability rows again. Each
 * cost a `BEGIN`, a five-part `set_config` and a `COMMIT` before it asked anything, so twelve of
 * the seventeen round trips every project page spent identifying its caller were framing rather
 * than questions (`docs/PERFORMANCE_BASELINE.md` §6).
 *
 * **The row-level envelope is unchanged, and that is the point of the exercise.** The order of the
 * statements is exactly what it was:
 *
 * 1. the user row is reconciled with only `app.user_id` set;
 * 2. the tenant is resolved with `app.tenant_id` still **unset**, so the membership join is what
 *    proves the tenant rather than a value the caller supplied;
 * 3. only then is the proven tenant adopted (`adoptTenantContext`), and the project, its
 *    memberships and the capability rows are read under it, with `app.project_id` left unset so
 *    the project policies decide access from membership.
 *
 * `SET LOCAL` expresses that ordering inside one transaction as exactly as two transactions did;
 * what disappears is the framing. The cross-tenant harness covers the merged envelope
 * (`packages/testing/test/rls/context-envelope.integration.test.ts`), because a change to the
 * authorization path is only as good as the test that says a forged slug still fails.
 */
export async function resolveAccessContext(
  db: Database,
  input: BuildRequestContextInput,
): Promise<AccessContext> {
  const userId = input.sessionUser.subject;
  const requestId = input.requestId ?? randomUUID();
  const locale = input.locale ?? "es-EC";

  return withDbContext(db, { userId, tenantId: null, projectId: null }, async (tx) => {
    await ensureUserRow(tx, input.sessionUser);

    const tenant = await resolveTenant(tx, userId, input.tenantSlug);
    if (!tenant) throw new PermissionDenied({ role: null, restrictedData: "tenant" });

    // Everything below runs under the tenant this transaction has just proved.
    await adoptTenantContext(tx, { userId, tenantId: tenant.tenantId });

    const tenantPermissions = TENANT_ROLE_PERMISSIONS[tenant.role];
    const tenantSettings = await loadTenantCapabilitySettings(tx, tenant.tenantId);

    if (!input.projectSlug) {
      return {
        tenantSettings,
        ctx: freezeContext<RequestContext>({
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
          capabilities: resolveCapabilities({ tenant: tenantSettings }),
          locale,
        }),
      };
    }

    // Project rows are visible to members and to tenant OWNER/ADMIN (administration); RLS
    // hides everything else, so a foreign or unassigned project yields "not found" → denied.
    const projects = await tx
      .select({
        id: appSchema.project.id,
        slug: appSchema.project.slug,
        profileKey: appSchema.project.profileKey,
      })
      .from(appSchema.project)
      .where(
        and(
          eq(appSchema.project.tenantId, tenant.tenantId),
          eq(appSchema.project.slug, input.projectSlug),
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

    const overrides = await loadProjectCapabilityOverrides(tx, tenant.tenantId, project.id);
    const profileDefaults = projectProfileDefaults(project.profileKey);
    const capabilities =
      projectRole || implicitOwnerProjectAccess || tenant.role === "ADMIN"
        ? resolveCapabilities({ tenant: tenantSettings, project: { overrides, profileDefaults } })
        : emptyCapabilitySet();

    return {
      tenantSettings,
      ctx: freezeContext<RequestContext>({
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
      }),
    };
  });
}

/**
 * Build the immutable RequestContext from the authenticated subject and the URL context.
 * Every identifier is verified against memberships inside the RLS-scoped transaction of
 * `resolveAccessContext`; a tenant or project the user has no access to is indistinguishable from
 * a non-existent one.
 */
export async function buildRequestContext(
  db: Database,
  input: BuildRequestContextInput,
): Promise<RequestContext> {
  return (await resolveAccessContext(db, input)).ctx;
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
