/**
 * Typed permission catalogue (TENANCY.md §3). A permission has exactly one scope.
 * Server code references these constants, never ad-hoc strings.
 */
export const TENANT_PERMISSIONS = [
  "tenant.transfer",
  "tenant.delete",
  "billing.manage",
  "members.manage",
  "roles.assign",
  "modules.manage",
  "templates.manage",
  "security.manage",
  "integrations.manage",
  "projects.create",
  "projects.archive",
  "project.members.manage",
  "audit.read",
  "portfolio.read",
  "profile.self",
] as const;

export const PROJECT_PERMISSIONS = [
  "project.configure",
  "project.members.manage",
  "parcels.read",
  "parcels.write",
  "geometry.import",
  // Field permissions are deliberately finer than one `field.*` bundle. `field.read` is the
  // operational workflow — campaigns, assignments, progress — which a GIS or environmental
  // specialist may legitimately see. Reading an individual person's answers is a separate,
  // narrower grant, because "can open the project" must never imply "can read every household's
  // responses" (SECURITY.md §10).
  "field.read",
  "field.campaigns.manage",
  "field.assignments.manage",
  "field.assignments.read_own",
  "field.capture",
  "field.responses.read",
  "field.validate",
  "field.write",
  "media.upload",
  "documents.read",
  "documents.write",
  // Social permissions are split the same way the field ones are, and for the same reason.
  // `social.read` is the deterministic, aggregated analytics — counts and distributions, nobody's
  // words. Reading an individual open response is not a new permission: it is the same datum
  // `field.responses.read` already governs, so the Social surfaces reuse that boundary instead of
  // minting a second key that could drift from it (SECURITY.md §10b).
  "social.read",
  "social.write",
  // Sending text to an external model, and settling what a response means, are separate acts from
  // reading analytics: one leaves the system, the other becomes the validated coding.
  "social.ai.run",
  "social.coding.review",
  "taxonomy.approve",
  "quality.read",
  "quality.write",
  "quality.review",
  "reports.write",
  "reports.review",
  "deliverables.approve",
  // The portal is a publication, and preparing one is not the same act as making it the thing the
  // client sees. `portal.preview` opens the draft and the standalone client view; `portal.publish`
  // decides. A reviewer checks what would go out without being able to send it.
  "portal.preview",
  "portal.publish",
  "pii.read",
  "pii.export",
  "provenance.read",
] as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];
export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number];
export type Permission = TenantPermission | ProjectPermission;
export type PermissionScope = "tenant" | "project";

const TENANT_SET: ReadonlySet<string> = new Set(TENANT_PERMISSIONS);
const PROJECT_SET: ReadonlySet<string> = new Set(PROJECT_PERMISSIONS);

/**
 * `project.members.manage` exists in both scopes on purpose: as a tenant permission it lets
 * OWNER/ADMIN administer memberships of any project (administration, not data access); as a
 * project permission it lets a COORDINATOR manage their own project's members.
 */
export function permissionScopes(permission: Permission): ReadonlyArray<PermissionScope> {
  const scopes: PermissionScope[] = [];
  if (TENANT_SET.has(permission)) scopes.push("tenant");
  if (PROJECT_SET.has(permission)) scopes.push("project");
  return scopes;
}

export function isTenantPermission(p: string): p is TenantPermission {
  return TENANT_SET.has(p);
}

export function isProjectPermission(p: string): p is ProjectPermission {
  return PROJECT_SET.has(p);
}
