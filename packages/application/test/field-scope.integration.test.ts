import {
  createAssignment,
  createCampaign,
  createParcelWithGeometry,
  createProjectMembership,
  createProvenanceRecord,
  createPublishedSurvey,
  createSpatialDatasetVersion,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveFieldScope } from "../src/index";

/**
 * *Whose work am I here to do?* — asked by a device that holds no pack.
 *
 * The bug this covers was not subtle once found: EIA Field derived the tenant and project of every
 * request from the pack it already held, so a fresh installation could never obtain the first one.
 * Sign-in succeeded, *Mi trabajo* was empty, and both buttons returned before doing anything.
 *
 * What is asserted here is the shape of the answer rather than the plumbing. **One** eligible
 * project yields a scope; none and several are named states, because a device that quietly picked
 * the first of several would be choosing which study a technician's morning belongs to. And
 * eligibility is an *assignment*, never a membership — that distinction is what stops a specialist
 * who was added to six projects from acquiring six mobile projects.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let prov: string;

const CAPABILITIES = ["core.projects", "gis.maps", "gis.parcels", "field.surveys"] as const;

interface Person {
  readonly id: string;
  readonly email: string;
  readonly tenantMembershipId: string;
}

/** A user with an active tenant membership in tenant A, and no project membership yet. */
async function makePerson(label: string, tenantId: string): Promise<Person> {
  const user = await createUser(db.migrator, label);
  const tenantMembership = await createTenantMembership(db.migrator, {
    tenantId,
    userId: user.id,
    role: "MEMBER",
  });
  return { id: user.id, email: user.email, tenantMembershipId: tenantMembership.id };
}

/**
 * One campaign and one dataset per project, created once.
 *
 * `spatial_dataset_version_one_active_idx` allows a single active version per project, so the
 * per-project scaffolding is memoised and only the assignment is per person.
 */
const projectFixtures = new Map<string, Promise<{ campaignId: string; datasetId: string }>>();

async function fixturesFor(project: { id: string }) {
  const existing = projectFixtures.get(project.id);
  if (existing) return existing;
  const created = (async () => {
    const survey = await createPublishedSurvey(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: project.id,
      provenanceId: prov,
    });
    const dataset = await createSpatialDatasetVersion(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: project.id,
      provenanceId: prov,
    });
    const campaign = await createCampaign(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: project.id,
      provenanceId: prov,
      surveyVersionId: survey.versionId,
      captureChannel: "EIA_FIELD_MOBILE",
    });
    return { campaignId: campaign.id, datasetId: dataset.id };
  })();
  projectFixtures.set(project.id, created);
  return created;
}

/** Field work for one person in one project: a parcel of their own and an assignment on it. */
async function giveFieldWork(
  person: Person,
  project: { id: string },
  options: { parcelCode: string; status?: "PENDING" | "COMPLETED" | "CANCELLED" } = {
    parcelCode: "001",
  },
): Promise<{ assignmentId: string }> {
  const { campaignId, datasetId } = await fixturesFor(project);
  const membership = await createProjectMembership(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: project.id,
    tenantMembershipId: person.tenantMembershipId,
    role: "FIELD_TECHNICIAN",
  });
  const parcel = await createParcelWithGeometry(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: project.id,
    datasetVersionId: datasetId,
    provenanceId: prov,
    parcelCode: options.parcelCode,
  });
  const assignment = await createAssignment(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: project.id,
    provenanceId: prov,
    campaignId,
    parcelId: parcel.parcelId,
    assigneeMembershipId: membership.id,
    assigneeUserId: person.id,
  });
  if (options.status && options.status !== "PENDING") {
    // Raw, because the point is the stored value rather than the use-case that would set it.
    await db.migrator.execute(
      sql`update app.field_assignment set status = ${options.status}::app.field_assignment_status where id = ${assignment.id}`,
    );
  }
  return { assignmentId: assignment.id };
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of CAPABILITIES) {
    await setTenantCapability(db.migrator, {
      tenantId: w.tenantA.id,
      key,
      entitled: true,
      enabled: true,
    });
  }
  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;
});

afterAll(() => db.close());

describe("the first Field Pack's scope", () => {
  it("names the one project a technician has open work in", async () => {
    const person = await makePerson("scope-one", w.tenantA.id);
    await giveFieldWork(person, w.projectX, { parcelCode: "101" });

    const scope = await resolveFieldScope(db.runtime, person.id);

    expect(scope).toEqual({
      kind: "scope",
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
      projectName: expect.any(String),
    });
  });

  it("refuses rather than guessing when the work spans two projects", async () => {
    const person = await makePerson("scope-two", w.tenantA.id);
    await giveFieldWork(person, w.projectX, { parcelCode: "201" });
    await giveFieldWork(person, w.projectY, { parcelCode: "202" });

    const scope = await resolveFieldScope(db.runtime, person.id);

    // Not the first project, not an error: a named state the screen can explain.
    expect(scope).toEqual({ kind: "multiple_field_projects", count: 2 });
  });

  it("says a person with no assignment has no field project", async () => {
    const person = await makePerson("scope-none", w.tenantA.id);

    const scope = await resolveFieldScope(db.runtime, person.id);

    expect(scope).toEqual({ kind: "no_field_project" });
  });

  it("does not turn project membership into a mobile project", async () => {
    /*
     * The distinction the whole resolver rests on. This person is a member of a project — with a
     * capture role, even — and has been given no work in it. A membership-derived answer would
     * hand them a pack; an assignment-derived one correctly finds nothing.
     */
    const person = await makePerson("scope-member-only", w.tenantA.id);
    await createProjectMembership(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      tenantMembershipId: person.tenantMembershipId,
      role: "FIELD_TECHNICIAN",
    });

    const scope = await resolveFieldScope(db.runtime, person.id);

    expect(scope).toEqual({ kind: "no_field_project" });
  });

  it("ignores work that is already finished or cancelled", async () => {
    const done = await makePerson("scope-completed", w.tenantA.id);
    await giveFieldWork(done, w.projectX, { parcelCode: "301", status: "COMPLETED" });
    expect(await resolveFieldScope(db.runtime, done.id)).toEqual({ kind: "no_field_project" });

    const cancelled = await makePerson("scope-cancelled", w.tenantA.id);
    await giveFieldWork(cancelled, w.projectX, { parcelCode: "302", status: "CANCELLED" });
    expect(await resolveFieldScope(db.runtime, cancelled.id)).toEqual({ kind: "no_field_project" });
  });

  it("never reaches across a tenant boundary", async () => {
    /*
     * A person who belongs to tenant B only. Tenant A holds plenty of eligible work by now, and
     * none of it is theirs to be told about — not the project, not its name, not that it exists.
     */
    const outsider = await makePerson("scope-other-tenant", w.tenantB.id);

    const scope = await resolveFieldScope(db.runtime, outsider.id);

    expect(scope).toEqual({ kind: "no_field_project" });
  });

  it("does not see another technician's assignments", async () => {
    /*
     * Two people, one project, one assignment each. The resolver runs with the project context
     * unset, so the only thing keeping these apart is `assignee_user_id = app.current_user_id()`
     * in `field_assignment_select` — which is the point of asserting it here rather than trusting
     * the query's own WHERE clause.
     */
    const worker = await makePerson("scope-own-a", w.tenantA.id);
    const bystander = await makePerson("scope-own-b", w.tenantA.id);
    await giveFieldWork(worker, w.projectY, { parcelCode: "401" });

    expect(await resolveFieldScope(db.runtime, worker.id)).toMatchObject({ kind: "scope" });
    expect(await resolveFieldScope(db.runtime, bystander.id)).toEqual({ kind: "no_field_project" });
  });
});
