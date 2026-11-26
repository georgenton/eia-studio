import { randomUUID } from "node:crypto";

import { appSchema } from "@eia/db";
import { PermissionDenied, type SessionUser } from "@eia/domain";
import { fieldMapResponseSchema } from "@eia/field-sync-contract";
import {
  createAssignment,
  createCampaign,
  createProvenanceRecord,
  createPublishedSurvey,
  createSpatialDatasetVersion,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildRequestContext, loadFieldMap } from "../src/index";

/**
 * The cartography a technician may download, and the two questions that decide what is in it.
 *
 * **Whose parcels?** Their own, by the row-level policy on `app.field_assignment` — *this row is
 * mine, or I hold `field.responses.read`* — and a technician holds neither `field.read` nor
 * `field.responses.read`. So a device asking for this cannot learn which parcels another
 * technician was given, how many, or where. Nothing is filtered out of a larger answer; the larger
 * answer is never assembled.
 *
 * **What about a parcel?** Its boundary or a point inside it, its code, its abscissa and its side.
 * The schema has nowhere to put an answer, a respondent, an owner, a household's position or a
 * photograph, which is why the first assertion here is that the response *parses* — a field that
 * should not exist could not get past it.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let provenanceId: string;
let alignmentVersionId: string;
let technician: { id: string; email: string };
let otherTechnician: { id: string; email: string };
let coordinator: { id: string; email: string };

const session = (user: { id: string; email: string }): SessionUser => ({
  subject: user.id,
  email: user.email,
  name: null,
  emailVerified: true,
});

const ctxFor = (user: { id: string; email: string }) =>
  buildRequestContext(db.runtime, {
    sessionUser: session(user),
    tenantSlug: w.tenantA.slug,
    projectSlug: w.projectX.slug,
  });

/** A member of project X with the given role. */
async function member(handle: string, role: "FIELD_TECHNICIAN" | "COORDINATOR") {
  const userId = randomUUID();
  await db.migrator
    .insert(appSchema.user)
    .values({ id: userId, email: `${handle}@factory.test`, name: handle });
  const [membership] = await db.migrator
    .insert(appSchema.tenantMembership)
    .values({ tenantId: w.tenantA.id, userId, role: "MEMBER", status: "active" })
    .returning({ id: appSchema.tenantMembership.id });
  const [projectMembership] = await db.migrator
    .insert(appSchema.projectMembership)
    .values({
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      tenantMembershipId: membership!.id,
      role,
      status: "active",
    })
    .returning({ id: appSchema.projectMembership.id });
  return {
    user: { id: userId, email: `${handle}@factory.test` },
    projectMembershipId: projectMembership!.id,
  };
}

/** One parcel with a square boundary, and one assignment of it to a technician. */
async function assignParcel(input: {
  code: string;
  lon: number;
  assigneeUserId: string;
  assigneeMembershipId: string;
  campaignId: string;
  withGeometry: boolean;
}): Promise<void> {
  const parcelId = randomUUID();
  await db.migrator.execute(sql`
    insert into app.parcel (id, tenant_id, project_id, parcel_code, side, status, chainage_m,
                            chainage_method, provenance_id)
    values (${parcelId}, ${w.tenantA.id}, ${w.projectX.id}, ${input.code}, 'right', 'estimated',
            1250.0, 'centroid_projection', ${provenanceId})
  `);
  if (input.withGeometry) {
    const d = 0.0008;
    const ring = [
      [input.lon, -3.79],
      [input.lon + d, -3.79],
      [input.lon + d, -3.79 + d],
      [input.lon, -3.79 + d],
      [input.lon, -3.79],
    ];
    const wkt = `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(", ")}))`;
    await db.migrator.execute(sql`
      insert into app.parcel_geometry (id, tenant_id, project_id, parcel_id, dataset_version_id,
                                       geom, area_m2, is_active, provenance_id)
      values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${parcelId},
              ${alignmentVersionId}, ST_GeomFromText(${wkt}, 4326), 7900.00, true, ${provenanceId})
    `);
  }
  await createAssignment(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId,
    campaignId: input.campaignId,
    parcelId,
    assigneeMembershipId: input.assigneeMembershipId,
    assigneeUserId: input.assigneeUserId,
  });
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of ["core.projects", "gis.maps", "gis.parcels", "field.surveys"] as const) {
    await db.migrator
      .insert(appSchema.tenantCapability)
      .values({ tenantId: w.tenantA.id, capabilityKey: key, entitled: true, enabled: true })
      .onConflictDoNothing();
  }
  provenanceId = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      title: "Cartografía de prueba",
    })
  ).id;

  const version = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId,
    kind: "alignment",
    analysisSrid: 32717,
    isActive: true,
  });
  alignmentVersionId = version.id;
  await db.migrator.execute(sql`
    insert into app.alignment (id, tenant_id, project_id, dataset_version_id, label, geom, length_m,
                               provenance_id)
    values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${alignmentVersionId},
            ${"Eje Bramadora"},
            ST_Multi(ST_GeomFromText('LINESTRING(-78.72 -3.79, -78.62 -3.79)', 4326)),
            11100.00, ${provenanceId})
  `);

  const t1 = await member("map-tech-1", "FIELD_TECHNICIAN");
  const t2 = await member("map-tech-2", "FIELD_TECHNICIAN");
  const coord = await member("map-coord", "COORDINATOR");
  technician = t1.user;
  otherTechnician = t2.user;
  coordinator = coord.user;

  // A published questionnaire and an active campaign, through the factories rather than by hand:
  // the schema of these tables is theirs to know, not this file's.
  const survey = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId,
  });
  const campaign = await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId,
    surveyVersionId: survey.versionId,
    captureChannel: "EIA_FIELD_MOBILE",
  });
  const campaignId = campaign.id;

  // Two parcels for this technician, one of them without geometry; one for somebody else.
  await assignParcel({
    code: "M-001",
    lon: -78.7,
    assigneeUserId: technician.id,
    assigneeMembershipId: t1.projectMembershipId,
    campaignId,
    withGeometry: true,
  });
  await assignParcel({
    code: "M-002",
    lon: -78.69,
    assigneeUserId: technician.id,
    assigneeMembershipId: t1.projectMembershipId,
    campaignId,
    withGeometry: false,
  });
  await assignParcel({
    code: "M-900",
    lon: -78.65,
    assigneeUserId: otherTechnician.id,
    assigneeMembershipId: t2.projectMembershipId,
    campaignId,
    withGeometry: true,
  });
});
afterAll(() => db.close());

describe("what a technician's device may download", () => {
  it("is exactly the shape the contract describes, and nothing more", async () => {
    const map = await loadFieldMap(db.runtime, await ctxFor(technician));
    // The schema is `.strict()`: a field that should not exist could not get past this.
    expect(() => fieldMapResponseSchema.parse(map)).not.toThrow();
    expect(map.projectName).toBe("Project project-x");
  });

  it("carries the axis as one continuous line, with its provenance", async () => {
    const map = await loadFieldMap(db.runtime, await ctxFor(technician));
    expect(map.axis).not.toBeNull();
    expect(map.axis?.label).toBe("Eje Bramadora");
    expect((map.axis?.coordinates.length ?? 0) >= 2).toBe(true);
    expect(map.provenance.datasetVersionLabel.length).toBeGreaterThan(0);
  });

  it("places the kilometre posts, and says the origin was not declared", async () => {
    const map = await loadFieldMap(db.runtime, await ctxFor(technician));
    expect(map.milestones.length).toBeGreaterThan(0);
    expect(map.milestones[0]?.label).toBe("0+000");
    // Nobody declared where 0+000 is, so the device must call these a calculated distance.
    expect(map.chainageDeclared).toBe(false);
    for (const post of map.milestones) {
      expect(post.at[1]).toBeCloseTo(-3.79, 2);
    }
  });

  it("carries the boundary of a parcel that has one", async () => {
    const map = await loadFieldMap(db.runtime, await ctxFor(technician));
    const first = map.parcels.find((p) => p.parcelCode === "M-001");
    expect(first?.place.kind).toBe("polygon");
    if (first?.place.kind !== "polygon") return;
    expect(first.place.ring.length).toBeGreaterThanOrEqual(4);
    // Closed, as GeoJSON requires.
    expect(first.place.ring[0]).toEqual(first.place.ring.at(-1));
    expect(first.chainageLabel).toBe("1+250");
    expect(first.side).toBe("right");
  });

  /*
   * A parcel the cartography cannot place is left out rather than pinned somewhere plausible. The
   * technician still has it in their work list, with its code and its abscissa; what they do not
   * get is a dot on a map that means nothing.
   */
  it("leaves out a parcel with no geometry rather than inventing a place for it", async () => {
    const map = await loadFieldMap(db.runtime, await ctxFor(technician));
    expect(map.parcels.some((p) => p.parcelCode === "M-002")).toBe(false);
  });

  /** The assertion this endpoint exists to be able to make. */
  it("never carries another technician's parcel", async () => {
    const mine = await loadFieldMap(db.runtime, await ctxFor(technician));
    expect(mine.parcels.map((p) => p.parcelCode)).toEqual(["M-001"]);
    expect(mine.parcels.some((p) => p.parcelCode === "M-900")).toBe(false);

    const theirs = await loadFieldMap(db.runtime, await ctxFor(otherTechnician));
    expect(theirs.parcels.map((p) => p.parcelCode)).toEqual(["M-900"]);
  });

  /*
   * A coordinator is refused, and refused for the same reason they are refused a Field Pack:
   * `field.assignments.read_own` is the technician's grant, and `buildWorkPack` requires it too.
   * The map is the device's resource, scoped to the work the caller holds; a coordinator reads the
   * project's cartography on the desk, where the surface and the permissions are different ones.
   *
   * Asserted rather than left implicit because the alternative shape — an empty list — would read
   * as "this coordinator has no parcels" instead of "this is not your resource".
   */
  it("refuses a coordinator, exactly as the Field Pack does", async () => {
    await expect(loadFieldMap(db.runtime, await ctxFor(coordinator))).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });
});

describe("who may ask at all", () => {
  it("refuses a member with no project role", async () => {
    await expect(loadFieldMap(db.runtime, await ctxFor(w.memberA))).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });
});
