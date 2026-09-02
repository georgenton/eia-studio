import type { RequestContext } from "./context";
import { PermissionDenied } from "./errors";
import { isProjectPermission, type Permission } from "./permissions";

/** UI may call this for rendering; every server entry point re-checks with requirePermission. */
export function can(ctx: RequestContext, permission: Permission): boolean {
  if (isProjectPermission(permission) && ctx.projectId === null) {
    // A project permission held via a tenant-scope grant (e.g. OWNER/ADMIN project.members.manage)
    // is only meaningful when the permission is also declared at tenant scope.
    return ctx.permissions.has(permission) && !onlyProjectScoped(permission);
  }
  return ctx.permissions.has(permission);
}

function onlyProjectScoped(permission: Permission): boolean {
  return permission !== "project.members.manage";
}

export function requirePermission(ctx: RequestContext, permission: Permission): void {
  if (!can(ctx, permission)) {
    throw new PermissionDenied({
      role: ctx.projectRole ?? ctx.tenantRole,
      restrictedData: permission,
    });
  }
}
