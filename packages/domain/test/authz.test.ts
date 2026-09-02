import { describe, expect, it } from "vitest";

import {
  OWNER_IMPLICIT_PROJECT_PERMISSIONS,
  PROJECT_PERMISSIONS,
  PROJECT_ROLES,
  PROJECT_ROLE_PERMISSIONS,
  PermissionDenied,
  TENANT_PERMISSIONS,
  TENANT_ROLES,
  TENANT_ROLE_PERMISSIONS,
  can,
  emptyCapabilitySet,
  permissionScopes,
  requirePermission,
  type Permission,
  type RequestContext,
} from "../src/index";

function ctx(overrides: Partial<RequestContext>): RequestContext {
  return Object.freeze({
    requestId: "r",
    userId: "u",
    tenantId: "t",
    tenantSlug: "t",
    tenantMembershipId: "tm",
    tenantRole: "MEMBER",
    projectId: null,
    projectSlug: null,
    projectMembershipId: null,
    projectRole: null,
    implicitOwnerProjectAccess: false,
    permissions: new Set<Permission>(),
    capabilities: emptyCapabilitySet(),
    locale: "es-EC",
    ...overrides,
  });
}

describe("permission catalogue", () => {
  it("every permission has a scope and only project.members.manage has both", () => {
    const all = [...TENANT_PERMISSIONS, ...PROJECT_PERMISSIONS];
    for (const p of all) expect(permissionScopes(p).length).toBeGreaterThan(0);
    const both = all.filter((p) => permissionScopes(p).length === 2);
    expect(new Set(both)).toEqual(new Set(["project.members.manage"]));
  });

  it("role → permission maps only use catalogued keys", () => {
    for (const role of TENANT_ROLES) {
      for (const p of TENANT_ROLE_PERMISSIONS[role]) expect(TENANT_PERMISSIONS).toContain(p);
    }
    for (const role of PROJECT_ROLES) {
      for (const p of PROJECT_ROLE_PERMISSIONS[role]) expect(PROJECT_PERMISSIONS).toContain(p);
    }
  });

  it("D-015: ADMIN has no project data permissions; OWNER implicit equals COORDINATOR; MEMBER has no admin rights", () => {
    expect(TENANT_ROLE_PERMISSIONS.ADMIN.has("members.manage")).toBe(true);
    for (const p of ["parcels.read", "pii.read", "social.read"] as const) {
      expect((TENANT_ROLE_PERMISSIONS.ADMIN as ReadonlySet<string>).has(p)).toBe(false);
    }
    expect(OWNER_IMPLICIT_PROJECT_PERMISSIONS).toBe(PROJECT_ROLE_PERMISSIONS.COORDINATOR);
    expect(TENANT_ROLE_PERMISSIONS.MEMBER.has("members.manage")).toBe(false);
    expect(TENANT_ROLE_PERMISSIONS.MEMBER.has("projects.create")).toBe(false);
    expect(PROJECT_ROLE_PERMISSIONS.VIEWER.has("pii.read")).toBe(false);
    expect(PROJECT_ROLE_PERMISSIONS.GIS_SPECIALIST.has("pii.read")).toBe(false);
  });
});

describe("requirePermission", () => {
  it("denies without the permission and names role + restricted data", () => {
    const c = ctx({ tenantRole: "ADMIN", permissions: new Set(TENANT_ROLE_PERMISSIONS.ADMIN) });
    expect(can(c, "members.manage")).toBe(true);
    expect(can(c, "parcels.read")).toBe(false);
    try {
      requirePermission(c, "parcels.read");
      expect.fail("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDenied);
      expect((error as PermissionDenied).role).toBe("ADMIN");
      expect((error as PermissionDenied).restrictedData).toBe("parcels.read");
    }
  });

  it("project permissions need a project context except administrative project.members.manage", () => {
    const perms = new Set<Permission>([...TENANT_ROLE_PERMISSIONS.ADMIN, "parcels.read"]);
    const tenantScope = ctx({ tenantRole: "ADMIN", permissions: perms });
    expect(can(tenantScope, "parcels.read")).toBe(false);
    expect(can(tenantScope, "project.members.manage")).toBe(true);
    const projectScope = ctx({
      tenantRole: "ADMIN",
      permissions: perms,
      projectId: "p",
      projectSlug: "p",
    });
    expect(can(projectScope, "parcels.read")).toBe(true);
  });
});
