import { randomUUID } from "node:crypto";

import { appSchema, type Database } from "@eia/db";

/**
 * Generic factories (TESTING_STRATEGY.md §1): tenant A / tenant B, projects X / Y / Z, users
 * with role names in their addresses. Never pilot data, never anything resembling a person.
 * Inserts run with the migrator connection (bypasses RLS) to arrange state; assertions then use
 * the runtime connection.
 */
export type TenantRoleName = "OWNER" | "ADMIN" | "MEMBER";
export type ProjectRoleName =
  | "COORDINATOR"
  | "SOCIAL_SPECIALIST"
  | "ENVIRONMENTAL_SPECIALIST"
  | "GIS_SPECIALIST"
  | "FIELD_TECHNICIAN"
  | "REVIEWER"
  | "VIEWER";

let counter = 0;
const next = () => (++counter).toString(36);

export async function createUser(
  db: Database,
  label: string,
): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `${label}-${next()}@factory.test`;
  await db.insert(appSchema.user).values({ id, email, name: label });
  return { id, email };
}

export async function createTenant(
  db: Database,
  slug: string,
): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .insert(appSchema.tenant)
    .values({ slug: `${slug}-${next()}`, name: `Tenant ${slug}` })
    .returning({ id: appSchema.tenant.id, slug: appSchema.tenant.slug });
  return row!;
}

export async function createTenantMembership(
  db: Database,
  input: { tenantId: string; userId: string; role: TenantRoleName },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(appSchema.tenantMembership)
    .values({ tenantId: input.tenantId, userId: input.userId, role: input.role, status: "active" })
    .returning({ id: appSchema.tenantMembership.id });
  return row!;
}

export async function createProject(
  db: Database,
  input: { tenantId: string; slug: string },
): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .insert(appSchema.project)
    .values({
      tenantId: input.tenantId,
      slug: `${input.slug}-${next()}`,
      name: `Project ${input.slug}`,
      profileKey: "test_profile",
      profileVersion: "1",
    })
    .returning({ id: appSchema.project.id, slug: appSchema.project.slug });
  return row!;
}

export async function createProjectMembership(
  db: Database,
  input: { tenantId: string; projectId: string; tenantMembershipId: string; role: ProjectRoleName },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(appSchema.projectMembership)
    .values({ ...input, status: "active" })
    .returning({ id: appSchema.projectMembership.id });
  return row!;
}

export async function setTenantCapability(
  db: Database,
  input: { tenantId: string; key: string; entitled: boolean; enabled: boolean },
): Promise<void> {
  await db
    .insert(appSchema.tenantCapability)
    .values({
      tenantId: input.tenantId,
      capabilityKey: input.key,
      entitled: input.entitled,
      enabled: input.enabled,
    })
    .onConflictDoUpdate({
      target: [appSchema.tenantCapability.tenantId, appSchema.tenantCapability.capabilityKey],
      set: { entitled: input.entitled, enabled: input.enabled },
    });
}

export interface TwoTenantWorld {
  readonly tenantA: { id: string; slug: string };
  readonly tenantB: { id: string; slug: string };
  readonly ownerA: { id: string; email: string; membershipId: string };
  readonly adminA: { id: string; email: string; membershipId: string };
  readonly memberA: { id: string; email: string; membershipId: string };
  readonly ownerB: { id: string; email: string; membershipId: string };
  readonly projectX: { id: string; slug: string }; // tenant A, memberA is VIEWER
  readonly projectY: { id: string; slug: string }; // tenant A, memberA has no membership
  readonly projectZ: { id: string; slug: string }; // tenant B
  readonly memberAProjectXMembershipId: string;
}

/** Two tenants, three users in A (owner, admin, member), one owner in B, three projects. */
export async function seedTwoTenantWorld(db: Database): Promise<TwoTenantWorld> {
  const tenantA = await createTenant(db, "tenant-a");
  const tenantB = await createTenant(db, "tenant-b");
  const ownerAUser = await createUser(db, "owner-a");
  const adminAUser = await createUser(db, "admin-a");
  const memberAUser = await createUser(db, "member-a");
  const ownerBUser = await createUser(db, "owner-b");
  const ownerA = await createTenantMembership(db, {
    tenantId: tenantA.id,
    userId: ownerAUser.id,
    role: "OWNER",
  });
  const adminA = await createTenantMembership(db, {
    tenantId: tenantA.id,
    userId: adminAUser.id,
    role: "ADMIN",
  });
  const memberA = await createTenantMembership(db, {
    tenantId: tenantA.id,
    userId: memberAUser.id,
    role: "MEMBER",
  });
  const ownerB = await createTenantMembership(db, {
    tenantId: tenantB.id,
    userId: ownerBUser.id,
    role: "OWNER",
  });
  const projectX = await createProject(db, { tenantId: tenantA.id, slug: "project-x" });
  const projectY = await createProject(db, { tenantId: tenantA.id, slug: "project-y" });
  const projectZ = await createProject(db, { tenantId: tenantB.id, slug: "project-z" });
  const pm = await createProjectMembership(db, {
    tenantId: tenantA.id,
    projectId: projectX.id,
    tenantMembershipId: memberA.id,
    role: "VIEWER",
  });
  for (const tenantId of [tenantA.id, tenantB.id]) {
    for (const key of [
      "core.projects",
      "gis.maps",
      "gis.parcels",
      "quality.document_gate",
      "client.portal",
    ]) {
      await setTenantCapability(db, { tenantId, key, entitled: true, enabled: true });
    }
  }
  return {
    tenantA,
    tenantB,
    ownerA: { ...ownerAUser, membershipId: ownerA.id },
    adminA: { ...adminAUser, membershipId: adminA.id },
    memberA: { ...memberAUser, membershipId: memberA.id },
    ownerB: { ...ownerBUser, membershipId: ownerB.id },
    projectX,
    projectY,
    projectZ,
    memberAProjectXMembershipId: pm.id,
  };
}
