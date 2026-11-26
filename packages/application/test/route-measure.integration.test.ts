import { randomUUID } from "node:crypto";

import { appSchema } from "@eia/db";
import type { SessionUser } from "@eia/domain";
import {
  createProvenanceRecord,
  createSpatialDatasetVersion,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "@eia/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildRequestContext, loadCorridorMilestones, measureRoute } from "../src/index";

/**
 * Measuring a road in metres, over the whole road.
 *
 * The audited intake measured `ST_GeometryN(geom, 1)` — the first part of a multi-part route —
 * took a position fraction in EPSG:4326, and multiplied it by that first part's projected length.
 * The three errors cancel out to something plausible on one short, straight, near-equatorial
 * segment, which is why nothing caught them. These assertions use geometry where they do not
 * cancel.
 *
 * The numbers here are metres on the ground at about 4° south, computed by PostGIS in EPSG:32717 —
 * the dataset version's own `analysis_srid`, never a zone inferred from the country.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let provenanceId: string;

const session = (user: { id: string; email: string }): SessionUser => ({
  subject: user.id,
  email: user.email,
  name: null,
  emailVerified: true,
});

/** One alignment, in its own dataset version, from literal WKT. */
async function alignmentFrom(wkt: string): Promise<string> {
  const version = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId,
    kind: "alignment",
    analysisSrid: 32717,
    /*
     * Not active. A project has one active version per dataset by unique index, and these are five
     * alternative deliveries of the same corridor rather than five corridors. Measuring does not
     * require activation — it reads the version it is given.
     */
    isActive: false,
  });
  await db.migrator.execute(sql`
    insert into app.alignment
      (id, tenant_id, project_id, dataset_version_id, label, geom, length_m, provenance_id)
    values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${version.id},
            ${"Eje de prueba"}, ST_Multi(ST_GeomFromText(${wkt}, 4326)), 1.00, ${provenanceId})
  `);
  return version.id;
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const key of ["core.projects", "gis.maps", "gis.parcels"] as const) {
    await db.migrator
      .insert(appSchema.tenantCapability)
      .values({ tenantId: w.tenantA.id, capabilityKey: key, entitled: true, enabled: true })
      .onConflictDoNothing();
  }
  provenanceId = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      title: "Eje de prueba",
    })
  ).id;
});
afterAll(() => db.close());

const ctxFor = () =>
  buildRequestContext(db.runtime, {
    sessionUser: session(w.memberA),
    tenantSlug: w.tenantA.slug,
    projectSlug: w.projectX.slug,
  });

describe("a route delivered in one piece", () => {
  it("is measured in metres, in the dataset version's own projected CRS", async () => {
    // Two vertices on the same parallel, a tenth of a degree apart: about 11.1 km at this latitude.
    const versionId = await alignmentFrom("LINESTRING(-78.72 -3.79, -78.62 -3.79)");
    const result = await measureRoute(db.runtime, await ctxFor(), versionId);

    expect(result.kind).toBe("measured");
    if (result.kind !== "measured") return;
    expect(result.analysisSrid).toBe(32717);
    expect(result.partsBeforeMerge).toBe(1);
    // Metres, not degrees. A length computed in 4326 would have come back as 0.1.
    expect(result.routeLengthM).toBeGreaterThan(11_000);
    expect(result.routeLengthM).toBeLessThan(11_200);
  });
});

describe("a route delivered in two pieces that meet", () => {
  /*
   * The defect, in one assertion. The pieces are 11.1 km and 5.5 km; `ST_GeometryN(geom, 1)` would
   * have returned the first and measured 11.1 km, and every abscissa past the join would have been
   * computed against a route two thirds of its real length.
   */
  it("is measured whole, not as its first piece", async () => {
    const versionId = await alignmentFrom(
      "MULTILINESTRING((-78.72 -3.79, -78.62 -3.79), (-78.62 -3.79, -78.57 -3.79))",
    );
    const result = await measureRoute(db.runtime, await ctxFor(), versionId);

    expect(result.kind).toBe("measured");
    if (result.kind !== "measured") return;
    expect(result.partsBeforeMerge).toBe(2);
    // ~16.6 km, and decisively not the ~11.1 km of the first piece alone.
    expect(result.routeLengthM).toBeGreaterThan(16_500);
    expect(result.routeLengthM).toBeLessThan(16_800);
  });

  it("gives that whole route the kilometre posts of the road, from a declared origin", async () => {
    const versionId = await alignmentFrom(
      "MULTILINESTRING((-78.72 -3.79, -78.62 -3.79), (-78.62 -3.79, -78.57 -3.79))",
    );
    const result = await loadCorridorMilestones(db.runtime, await ctxFor(), {
      datasetVersionId: versionId,
      startChainageM: 2_000,
      direction: "forward",
    });

    expect("milestones" in result).toBe(true);
    if (!("milestones" in result)) return;
    expect(result.declared).toBe(true);
    // 2+000 → about 18+600: the posts are the road's kilometres, not a count from the first vertex.
    expect(result.milestones[0]?.label).toBe("2+000");
    expect(result.milestones.at(-1)?.label).toBe("18+000");
    expect(result.milestones).toHaveLength(17);
  });

  /*
   * And the honest label when nobody declared an origin. The posts are still drawn — a technician
   * needs something to navigate by — but `declared` is false, and every surface that renders them
   * has to say they are a calculated distance rather than the study's abscissado.
   */
  /**
   * Block C.5: a post is not a label, it is a place.
   *
   * The arithmetic said *where along the route* each kilometre falls; this is the half that turns
   * that into a coordinate, interpolated on **the same projected route the length came from**. The
   * cases that matter are the ones a first-piece-only measurement got wrong: a post past the join,
   * an origin that is not zero, and a reversed frame.
   */
  it("places each post on the route, including past the first piece", async () => {
    const versionId = await alignmentFrom(
      "MULTILINESTRING((-78.72 -3.79, -78.62 -3.79), (-78.62 -3.79, -78.57 -3.79))",
    );
    const result = await loadCorridorMilestones(db.runtime, await ctxFor(), {
      datasetVersionId: versionId,
      startChainageM: 0,
      direction: "forward",
    });
    expect("milestones" in result).toBe(true);
    if (!("milestones" in result)) return;

    // Monotonic along the corridor, which runs west to east on one parallel.
    const longitudes = result.milestones.map((m) => m.longitude);
    expect(longitudes).toEqual([...longitudes].sort((a, b) => a - b));
    // Every post is on the parallel the route follows, so latitude barely moves.
    for (const m of result.milestones) expect(m.latitude).toBeCloseTo(-3.79, 3);
    // And the posts past the join are east of it, which a first-piece measurement could not do.
    const join = -78.62;
    expect(result.milestones.some((m) => m.longitude > join)).toBe(true);
    // The ends of the merged route are returned, because the merge does not prove orientation.
    expect(result.startPoint.longitude).toBeCloseTo(-78.72, 3);
    expect(result.endPoint.longitude).toBeCloseTo(-78.57, 3);
  });

  it("mirrors the places when the frame runs against the geometry", async () => {
    const versionId = await alignmentFrom("LINESTRING(-78.72 -3.79, -78.62 -3.79)");
    const forward = await loadCorridorMilestones(db.runtime, await ctxFor(), {
      datasetVersionId: versionId,
      startChainageM: 0,
      direction: "forward",
    });
    const reversed = await loadCorridorMilestones(db.runtime, await ctxFor(), {
      datasetVersionId: versionId,
      startChainageM: 12_000,
      direction: "reverse",
    });
    if (!("milestones" in forward) || !("milestones" in reversed)) throw new Error("discontinuous");

    /*
     * Same road, same geometry, opposite numbering. `0+000` sits at the first vertex going forward
     * and the highest post sits there going backwards — which is the property a label alone cannot
     * show and the reason the places are computed rather than assumed.
     */
    expect(forward.milestones[0]?.label).toBe("0+000");
    expect(forward.milestones[0]?.longitude).toBeCloseTo(-78.72, 3);
    expect(reversed.milestones.at(-1)?.label).toBe("12+000");
    expect(reversed.milestones.at(-1)?.longitude).toBeCloseTo(-78.72, 3);
  });

  it("says when the origin was assumed rather than declared", async () => {
    const versionId = await alignmentFrom("LINESTRING(-78.72 -3.79, -78.62 -3.79)");
    const result = await loadCorridorMilestones(db.runtime, await ctxFor(), {
      datasetVersionId: versionId,
    });
    expect("declared" in result && result.declared).toBe(false);
  });
});

describe("a route delivered with a gap", () => {
  /*
   * Two pieces that do not touch. Joining them would turn 20 km of absent road into route length,
   * shift every abscissa after the gap by that amount, and draw kilometre posts where there is no
   * road. So nothing is measured and the delivery is reported.
   */
  it("is reported as discontinuous rather than joined", async () => {
    const versionId = await alignmentFrom(
      "MULTILINESTRING((-78.72 -3.79, -78.62 -3.79), (-78.42 -3.79, -78.37 -3.79))",
    );
    const result = await measureRoute(db.runtime, await ctxFor(), versionId);

    expect(result.kind).toBe("discontinuous");
    if (result.kind !== "discontinuous") return;
    expect(result.partsAfterMerge).toBe(2);
  });

  it("produces no milestones at all for a route that cannot be walked", async () => {
    const versionId = await alignmentFrom(
      "MULTILINESTRING((-78.72 -3.79, -78.62 -3.79), (-78.42 -3.79, -78.37 -3.79))",
    );
    const result = await loadCorridorMilestones(db.runtime, await ctxFor(), {
      datasetVersionId: versionId,
      startChainageM: 0,
      direction: "forward",
    });
    expect("kind" in result && result.kind).toBe("discontinuous");
  });
});
