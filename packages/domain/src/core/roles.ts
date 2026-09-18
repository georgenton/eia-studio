import type { ProjectPermission, TenantPermission } from "./permissions";

/** Fixed system roles (Gate 1 D-015). Custom roles are out of scope; see docs/TENANCY.md §2.3. */
export const TENANT_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export const PROJECT_ROLES = [
  "COORDINATOR",
  "PROJECT_DATA_MANAGER",
  "SOCIAL_SPECIALIST",
  "ENVIRONMENTAL_SPECIALIST",
  "GIS_SPECIALIST",
  "FIELD_TECHNICIAN",
  "REVIEWER",
  "VIEWER",
] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];
export type ProjectRole = (typeof PROJECT_ROLES)[number];

const ADMIN_TENANT_PERMISSIONS: readonly TenantPermission[] = [
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
];

export const TENANT_ROLE_PERMISSIONS: Readonly<Record<TenantRole, ReadonlySet<TenantPermission>>> =
  {
    OWNER: new Set<TenantPermission>([
      "tenant.transfer",
      "tenant.delete",
      "billing.manage",
      ...ADMIN_TENANT_PERMISSIONS,
    ]),
    ADMIN: new Set<TenantPermission>(ADMIN_TENANT_PERMISSIONS),
    MEMBER: new Set<TenantPermission>(["portfolio.read", "profile.self"]),
  };

const READ_ALL_EXCEPT_PII: readonly ProjectPermission[] = [
  "project.intake.read",
  "parcels.read",
  "field.read",
  "documents.read",
  "social.read",
  "quality.read",
  "provenance.read",
];

export const PROJECT_ROLE_PERMISSIONS: Readonly<
  Record<ProjectRole, ReadonlySet<ProjectPermission>>
> = {
  COORDINATOR: new Set<ProjectPermission>([
    "project.configure",
    "project.members.manage",
    "project.intake.read",
    "project.intake.write",
    "parcels.read",
    "parcels.write",
    "field.read",
    "field.campaigns.manage",
    "field.assignments.manage",
    "field.responses.read",
    "field.write",
    "field.validate",
    // Writes the questionnaire *and* decides it may be asked (ADR-037). The second key is the
    // coordinator's alone: a published definition is what a campaign resolves answers against.
    "field.instruments.author",
    "field.instruments.publish",
    "documents.read",
    "documents.write",
    "social.read",
    "quality.read",
    "quality.write",
    "reports.write",
    "deliverables.approve",
    "portal.preview",
    "portal.publish",
    "pii.read",
    "provenance.read",
  ]),
  /**
   * *Gestor de información* / Project Data Manager (ADR-030).
   *
   * The role that prepares a project so it can be operated: its identity and settings, its
   * cartography, its corpus, and the readiness report that says what is still missing. Every grant
   * below is there because a stage of the intake needs it.
   *
   * What is **absent** is the point of the role. No `field.responses.read`, so they never read a
   * household's answers; no `social.coding.review` or `quality.review`, so they settle nothing; no
   * `portal.publish`, so they make no statement to the client; no `project.configure`, so they
   * cannot turn a module on or off; and nothing tenant-wide. A person who loads a project's files
   * is not thereby a person who may read what a family said to a technician.
   */
  PROJECT_DATA_MANAGER: new Set<ProjectPermission>([
    "project.intake.read",
    "project.intake.write",
    "parcels.read",
    "parcels.write",
    "geometry.import",
    // The operational workflow — campaigns, assignments, counts — which the readiness report and
    // the intake's field stage read. Deliberately *not* `field.responses.read` (SECURITY.md §10b).
    "field.read",
    // Writing the instrument is preparation: it is the form, not anybody's answers, and a project
    // that has no questionnaire cannot be operated at all (ADR-037). Deliberately *not*
    // `field.instruments.publish`: deciding that households will be asked this is the
    // coordinator's decision, and this role decides nothing.
    "field.instruments.author",
    "documents.read",
    "documents.write",
    "provenance.read",
  ]),
  SOCIAL_SPECIALIST: new Set<ProjectPermission>([
    "parcels.read",
    "field.read",
    "field.assignments.manage",
    "field.responses.read",
    "field.validate",
    "documents.read",
    "social.read",
    "social.write",
    "social.ai.run",
    "social.coding.review",
    "taxonomy.approve",
    "quality.read",
    "quality.write",
    "reports.write",
    "pii.read",
    "pii.export",
    "provenance.read",
  ]),
  ENVIRONMENTAL_SPECIALIST: new Set<ProjectPermission>([
    "parcels.read",
    "field.read",
    "documents.read",
    "documents.write",
    "quality.read",
    "quality.write",
    "reports.write",
    "provenance.read",
  ]),
  GIS_SPECIALIST: new Set<ProjectPermission>([
    "parcels.read",
    "parcels.write",
    "geometry.import",
    "field.read",
    "quality.read",
    "provenance.read",
  ]),
  // A technician captures. They read *their own* assignments and never browse the project's
  // responses: `field.read` and `field.responses.read` are both absent, and the RLS policies say
  // the same thing again at the row level.
  FIELD_TECHNICIAN: new Set<ProjectPermission>([
    "parcels.read",
    "field.assignments.read_own",
    "field.capture",
    "media.upload",
    "provenance.read",
  ]),
  REVIEWER: new Set<ProjectPermission>([
    // A reviewer may read how far a project's preparation has got; they do not do the preparing.
    "project.intake.read",
    "documents.read",
    "field.read",
    "field.responses.read",
    // A reviewer decides; that is the role's whole meaning, and settling a coding is the same kind
    // of act as deciding a finding. They do not initiate model runs.
    "social.read",
    "social.coding.review",
    "quality.read",
    "quality.review",
    "reports.review",
    // A reviewer may open what the client would see, and may not publish it. Checking a
    // publication before it goes out is review work; deciding that it goes out is the
    // coordinator's.
    "portal.preview",
    "provenance.read",
  ]),
  VIEWER: new Set<ProjectPermission>(READ_ALL_EXCEPT_PII),
};

/** Roles that may assign other roles, ordered high → low for escalation checks. */
export const TENANT_ROLE_RANK: Readonly<Record<TenantRole, number>> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

/**
 * OWNER implicit project access (D-015): computed, never stored, equals the COORDINATOR set.
 * Callers must record an audit event when it is exercised (see tenancy/request-context.ts).
 */
export const OWNER_IMPLICIT_PROJECT_PERMISSIONS: ReadonlySet<ProjectPermission> =
  PROJECT_ROLE_PERMISSIONS.COORDINATOR;

export function isTenantRole(value: string): value is TenantRole {
  return (TENANT_ROLES as readonly string[]).includes(value);
}

export function isProjectRole(value: string): value is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(value);
}

/**
 * What a role is called on screen (TENANCY.md §2).
 *
 * The keys are the authorization model's; these are the words. `COORDINATOR` is what the code
 * checks and *Coordinador de proyecto* is what the person reading the topbar is.
 */
/* A role's words are `vocabulary.tenantRole.*` and `vocabulary.projectRole.*` in `@eia/i18n`. */
