import { randomUUID } from "node:crypto";

import { appSchema } from "@eia/db";
import { PermissionDenied, type SessionUser } from "@eia/domain";
import { fieldMapResponseSchema, fieldMapResponseV2Schema } from "@eia/field-sync-contract";
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
/** Shared with the geometry block below, which adds parcels to the same campaign. */
let sharedCampaignId: string;
let technicianMembershipId: string;

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
  /** Explicit geometry, for the multi-part and holed cases. */
  wkt?: string;
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
    const wkt = input.wkt ?? `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(", ")}))`;
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
  sharedCampaignId = campaignId;
  technicianMembershipId = t1.projectMembershipId;

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

  /**
   * The field that broke the whole map, caught on a handset and not on the server.
   *
   * `spatial_dataset_version.note` is not a sentence: the corridor importer writes a JSON record of
   * the contract into it — source hashes, feature count, condition. Sending it whole put three
   * hundred characters into a forty-character field and the device's `.strict()` schema rejected
   * the **entire** map. The server was perfectly happy producing it.
   */
  it("sends the delivery's declared condition, not the importer's whole record", async () => {
    await db.migrator.execute(sql`
      update app.spatial_dataset_version
         set note = ${'{"contract":"corridor-intake@2","kind":"alignment","sourceSha256":"' + "a".repeat(64) + '","condition":"PRELIMINARY_DRAFT","featureCount":1}'}
       where tenant_id = ${w.tenantA.id} and id = ${alignmentVersionId}
    `);
    const map = await loadFieldMap(db.runtime, await ctxFor(technician));
    expect(map.provenance.condition).toBe("PRELIMINARY_DRAFT");
    // And it parses, which is the assertion that actually failed on the device.
    expect(() => fieldMapResponseSchema.parse(map)).not.toThrow();
  });

  it("says nothing rather than truncating a note it cannot read", async () => {
    await db.migrator.execute(sql`
      update app.spatial_dataset_version
         set note = ${"una nota que alguien escribió a mano, larguísima, " + "x".repeat(300)}
       where tenant_id = ${w.tenantA.id} and id = ${alignmentVersionId}
    `);
    const map = await loadFieldMap(db.runtime, await ctxFor(technician));
    expect(map.provenance.condition).toBeNull();
    expect(() => fieldMapResponseSchema.parse(map)).not.toThrow();
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

/**
 * What the device is given of a parcel's shape, and of the road.
 *
 * Three limits lived in this read model, and each one lost something without saying so:
 *
 *   * `ST_GeometryN(…, 1)` kept **one piece** of a multi-part parcel — whichever the cartography
 *     stored first — and presented it as the parcel. Twenty of the study's 141 are multi-part;
 *     a technician sent to the smaller piece would have been looking at the wrong field.
 *   * `ST_ExteriorRing` dropped **holes**, so a right of way or an excluded plot was drawn as
 *     solid ground.
 *   * `slice(0, axisVertexLimit)` kept the **first N vertices** of the road and dropped the tail,
 *     so a parcel at the far end of a corridor had no road beside it at all.
 *
 * None of the three announced itself. These assertions are about the geometry arriving whole.
 */
describe("the geometry the device is given", () => {
  const BASE_LON = -78.6;

  it("keeps every piece of a multi-part parcel, not just the first", async () => {
    /*
     * Two squares, the second **larger** and listed second. Under the old query the device got
     * the first — the smaller one — and nothing said the rest existed.
     */
    const small =
      "((-78.600 -3.790, -78.5996 -3.790, -78.5996 -3.7896, -78.600 -3.7896, -78.600 -3.790))";
    const large =
      "((-78.598 -3.790, -78.5968 -3.790, -78.5968 -3.7888, -78.598 -3.7888, -78.598 -3.790))";
    await assignParcel({
      code: "MULTI-1",
      lon: BASE_LON,
      assigneeUserId: technician.id,
      assigneeMembershipId: technicianMembershipId,
      campaignId: sharedCampaignId,
      withGeometry: true,
      wkt: `MULTIPOLYGON(${small}, ${large})`,
    });

    // Parsed with the version 2 schema: it narrows the type *and* asserts the contract.
    const map = fieldMapResponseV2Schema.parse(
      await loadFieldMap(db.runtime, await ctxFor(technician), { acceptsSchemaVersion: 2 }),
    );
    const parcel = map.parcels.find((p) => p.parcelCode === "MULTI-1")!;
    if (parcel.place.kind !== "polygon") throw new Error("expected a polygon");

    expect(parcel.place.parts).toHaveLength(2);
    // And the version 1 ring is the **largest** piece, not the first one — the one improvement an
    // installed build gets without being updated.
    const areas = parcel.place.parts.map((part) =>
      Math.abs(
        part.outer.reduce((sum, [x1, y1], i) => {
          const [x2, y2] = part.outer[(i + 1) % part.outer.length]!;
          return sum + (x1 * y2 - x2 * y1);
        }, 0),
      ),
    );
    const largestIndex = areas.indexOf(Math.max(...areas));
    expect(parcel.place.ring).toEqual(parcel.place.parts[largestIndex]!.outer);
  });

  it("keeps a hole as a hole rather than drawing it as ground", async () => {
    const outer =
      "(-78.610 -3.790, -78.6060 -3.790, -78.6060 -3.7860, -78.610 -3.7860, -78.610 -3.790)";
    const hole =
      "(-78.6090 -3.7890, -78.6075 -3.7890, -78.6075 -3.7875, -78.6090 -3.7875, -78.6090 -3.7890)";
    await assignParcel({
      code: "HOYO-1",
      lon: -78.61,
      assigneeUserId: technician.id,
      assigneeMembershipId: technicianMembershipId,
      campaignId: sharedCampaignId,
      withGeometry: true,
      wkt: `POLYGON(${outer}, ${hole})`,
    });

    const map = fieldMapResponseV2Schema.parse(
      await loadFieldMap(db.runtime, await ctxFor(technician), { acceptsSchemaVersion: 2 }),
    );
    const parcel = map.parcels.find((p) => p.parcelCode === "HOYO-1")!;
    if (parcel.place.kind !== "polygon") throw new Error("expected a polygon");

    expect(parcel.place.parts).toHaveLength(1);
    expect(parcel.place.parts[0]!.holes).toHaveLength(1);
    // The hole is inside the outer ring, which is the whole point of keeping it.
    const [hx, hy] = parcel.place.parts[0]!.holes[0]![0]!;
    const xs = parcel.place.parts[0]!.outer.map(([x]) => x);
    const ys = parcel.place.parts[0]!.outer.map(([, y]) => y);
    expect(hx).toBeGreaterThan(Math.min(...xs));
    expect(hx).toBeLessThan(Math.max(...xs));
    expect(hy).toBeGreaterThan(Math.min(...ys));
    expect(hy).toBeLessThan(Math.max(...ys));
  });

  it("answers a build that cannot read parts in version 1, with no extra field", async () => {
    await assignParcel({
      code: "COMPAT-1",
      lon: -78.62,
      assigneeUserId: technician.id,
      assigneeMembershipId: technicianMembershipId,
      campaignId: sharedCampaignId,
      withGeometry: true,
    });

    /*
     * The compatibility that matters: an installed build holds a `.strict()` schema pinned to
     * `schemaVersion: 1`. An unknown key or a different version number is a parse error and **no
     * map at all** on a phone already in somebody's hand.
     */
    const map = await loadFieldMap(db.runtime, await ctxFor(technician));
    expect(map.schemaVersion).toBe(1);
    expect(() => fieldMapResponseSchema.parse(map)).not.toThrow();
    for (const parcel of map.parcels) {
      if (parcel.place.kind === "polygon") expect("parts" in parcel.place).toBe(false);
    }
  });

  it("simplifies the whole axis instead of cutting its tail off", async () => {
    /*
     * A very low ceiling, so the limit certainly bites. What must survive is the road's **extent**
     * — both ends — because a parcel at the far end of a corridor needs the road beside it, and
     * taking the first N vertices is precisely what removed it.
     */
    const whole = fieldMapResponseV2Schema.parse(
      await loadFieldMap(db.runtime, await ctxFor(technician), { acceptsSchemaVersion: 2 }),
    );
    const tiny = fieldMapResponseV2Schema.parse(
      await loadFieldMap(db.runtime, await ctxFor(technician), {
        axisVertexLimit: 8,
        acceptsSchemaVersion: 2,
      }),
    );
    expect(whole.axis).not.toBeNull();
    expect(tiny.axis).not.toBeNull();
    expect(tiny.axis!.coordinates.length).toBeLessThanOrEqual(8);

    const extent = (coords: ReadonlyArray<readonly [number, number]>) => ({
      west: Math.min(...coords.map(([x]) => x)),
      east: Math.max(...coords.map(([x]) => x)),
      south: Math.min(...coords.map(([, y]) => y)),
      north: Math.max(...coords.map(([, y]) => y)),
    });
    const full = extent(whole.axis!.coordinates);
    const cut = extent(tiny.axis!.coordinates);
    // Within a metre or so of the same ground: coarser, not shorter.
    expect(Math.abs(cut.west - full.west)).toBeLessThan(0.0005);
    expect(Math.abs(cut.east - full.east)).toBeLessThan(0.0005);
    expect(Math.abs(cut.south - full.south)).toBeLessThan(0.0005);
    expect(Math.abs(cut.north - full.north)).toBeLessThan(0.0005);
    // And both ends are literally the road's own ends.
    expect(tiny.axis!.coordinates[0]).toEqual(whole.axis!.coordinates[0]);
    expect(tiny.axis!.coordinates.at(-1)).toEqual(whole.axis!.coordinates.at(-1));
  });
});
