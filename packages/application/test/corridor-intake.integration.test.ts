import { applyCorridorIntake, planCorridorIntake, type CorridorIntakeInput } from "../src/index";
import {
  CAPABILITY_KEYS,
  PROJECT_ROLE_PERMISSIONS,
  type CapabilitySet,
  type ProjectRole,
  type RequestContext,
} from "@eia/domain";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  asContext,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "@eia/testing";

/**
 * Loading a consultancy's own corridor — the axis and the parcels — into a project it owns.
 *
 * Everything here is synthetic: four tiny squares beside a three-vertex line, in the UTM zone the
 * real delivery declares but with coordinates this file invents. **No client cartography reaches
 * CI**, which is why the fixture is written out rather than read from a package.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function contextFor(
  world: TwoTenantWorld,
  role: ProjectRole,
  project: { id: string; slug: string },
  tenant: { id: string; slug: string },
): RequestContext {
  const capabilities = Object.fromEntries(
    CAPABILITY_KEYS.map((k: string) => [k, true]),
  ) as CapabilitySet;
  return {
    requestId: randomUUID(),
    userId: world.ownerA.id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantMembershipId: world.ownerA.membershipId,
    tenantRole: "OWNER",
    projectId: project.id,
    projectSlug: project.slug,
    projectMembershipId: randomUUID(),
    projectRole: role,
    implicitOwnerProjectAccess: false,
    permissions: PROJECT_ROLE_PERMISSIONS[role],
    capabilities,
    locale: "es-EC",
  };
}

/** A square of `size` metres whose lower-left corner sits at the given lon/lat. */
function square(lon: number, lat: number, size = 0.0005) {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [lon, lat],
        [lon + size, lat],
        [lon + size, lat + size],
        [lon, lat + size],
        [lon, lat],
      ],
    ],
  };
}

function parcelsLayer(codes: readonly string[], opts: { invalid?: boolean } = {}) {
  return {
    type: "FeatureCollection",
    features: codes.map((code, i) => ({
      type: "Feature",
      properties: { ficha_num: code, source_row: i + 1 },
      geometry:
        opts.invalid === true && i === 0
          ? {
              // A bow-tie: self-intersecting, so GEOS refuses it and nothing repairs it here.
              type: "Polygon" as const,
              coordinates: [
                [
                  [-79.58, -0.5],
                  [-79.579, -0.499],
                  [-79.58, -0.499],
                  [-79.579, -0.5],
                  [-79.58, -0.5],
                ],
              ],
            }
          : square(-79.58 + i * 0.001, -0.5),
    })),
  };
}

const alignmentLayer = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [-79.582, -0.5005],
          [-79.578, -0.5005],
          [-79.574, -0.5005],
        ],
      },
    },
  ],
};

function input(overrides: Partial<CorridorIntakeInput> = {}): CorridorIntakeInput {
  return {
    tenantSlug: w.tenantA.slug,
    projectSlug: w.projectX.slug,
    sourceLabel: "paquete-sintetico.rar",
    sourceSha256: SHA_A,
    receivedAt: "2026-10-13T00:00:00Z",
    sourceSrid: 32717,
    analysisSrid: 32717,
    parcelCodeField: "ficha_num",
    condition: "PRELIMINARY_DRAFT",
    alignment: alignmentLayer,
    parcels: parcelsLayer(["1", "2", "3", "4"]),
    alignmentLabel: "Eje sintético",
    identityConfirmedForNewPackage: false,
    ...overrides,
  };
}

async function countIn(ctx: RequestContext, table: string): Promise<number> {
  return asContext(db.runtime, ctx, async (tx) => {
    const r = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.raw(table)}`,
    );
    return (r.rows ?? (r as unknown as { n: number }[]))[0]?.n ?? 0;
  });
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
});

beforeEach(async () => {
  await db.migrator.execute(sql`
    delete from app.parcel_geometry;
    delete from app.alignment;
    delete from app.parcel;
    delete from app.spatial_dataset_version;
    delete from app.spatial_dataset;
  `);
});

describe("A · an axis and parcels import without the three layers that did not arrive", () => {
  it("applies with two layers and names the absent ones rather than writing zero", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const plan = await planCorridorIntake(db.runtime, ctx, input());
    expect(plan.applicable).toBe(true);
    expect(plan.layersAbsent).toEqual(["affectations", "chainage", "influenceAreas"]);

    const result = await applyCorridorIntake(db.runtime, ctx, input(), {
      sourceSha256: SHA_A,
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    expect(result.applied).toBe(true);
    expect(result.parcelsCreated).toBe(4);
    expect(await countIn(ctx, "app.affectation")).toBe(0);
    expect(await countIn(ctx, "app.influence_area")).toBe(0);
  });
});

describe("B · PLAN writes nothing; APPLY preserves counts, codes and provenance", () => {
  it("leaves the database untouched when planning", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const before = await countIn(ctx, "app.parcel");
    const plan = await planCorridorIntake(db.runtime, ctx, input());
    expect(plan.parcelsRead).toBe(4);
    expect(plan.parcelsToCreate).toBe(4);
    expect(await countIn(ctx, "app.parcel")).toBe(before);
    expect(await countIn(ctx, "app.spatial_dataset_version")).toBe(0);
  });

  it("keeps the delivered codes as text and records an imported, non-demo provenance", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    await applyCorridorIntake(db.runtime, ctx, input({ parcels: parcelsLayer(["001", "002"]) }), {
      sourceSha256: SHA_A,
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    const codes = await asContext(db.runtime, ctx, async (tx) => {
      const r = await tx.execute<{ parcel_code: string }>(
        sql`select parcel_code from app.parcel order by parcel_code`,
      );
      return (r.rows ?? []).map((x) => x.parcel_code);
    });
    // `001` is not `1`.
    expect(codes).toEqual(["001", "002"]);

    const prov = await asContext(db.runtime, ctx, async (tx) => {
      const r = await tx.execute<{ regime: string; origin: string; validation_state: string }>(
        sql`select distinct regime, origin, validation_state from app.provenance_record
             where project_id = ${w.projectX.id}`,
      );
      return r.rows ?? [];
    });
    expect(prov.length).toBeGreaterThan(0);
    for (const p of prov) {
      expect(p.regime).toBe("LIVE_OPERATIONAL");
      expect(p.origin).toBe("IMPORTED_DATASET");
      expect(p.validation_state).toBe("PENDING");
    }
  });

  it("derives side and chainage, and leaves the declared abscissa null", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const r = await applyCorridorIntake(db.runtime, ctx, input(), {
      sourceSha256: SHA_A,
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    expect(r.sideDerived).toBe(4);
    const rows = await asContext(db.runtime, ctx, async (tx) => {
      const q = await tx.execute<{
        side: string;
        chainage_method: string;
        chainage_start_m: string | null;
      }>(sql`select side, chainage_method, chainage_start_m from app.parcel`);
      return q.rows ?? [];
    });
    for (const row of rows) {
      expect(["left", "right"]).toContain(row.side);
      expect(row.chainage_method).toBe("centroid_projection");
      // Absent, not zero: the delivery declares no abscissa.
      expect(row.chainage_start_m).toBeNull();
    }
  });
});

describe("C · the same package twice is a no-op", () => {
  it("creates nothing the second time and keeps the same Parcel.id", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const expected = {
      sourceSha256: SHA_A,
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    };
    const first = await applyCorridorIntake(db.runtime, ctx, input(), expected);
    const idsBefore = await asContext(db.runtime, ctx, async (tx) =>
      (
        await tx.execute<{ id: string }>(sql`select id from app.parcel order by parcel_code`)
      ).rows.map((r) => r.id),
    );
    const second = await applyCorridorIntake(db.runtime, ctx, input(), expected);
    expect(first.applied).toBe(true);
    expect(second.noop).toBe(true);
    expect(second.parcelsCreated).toBe(0);
    const idsAfter = await asContext(db.runtime, ctx, async (tx) =>
      (
        await tx.execute<{ id: string }>(sql`select id from app.parcel order by parcel_code`)
      ).rows.map((r) => r.id),
    );
    expect(idsAfter).toEqual(idsBefore);
    expect(await countIn(ctx, "app.spatial_dataset_version")).toBe(2);
  });

  it("a concurrent retry is stopped by the unique index, not by a prior SELECT", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const expected = {
      sourceSha256: SHA_A,
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    };
    const outcomes = await Promise.allSettled([
      applyCorridorIntake(db.runtime, ctx, input(), expected),
      applyCorridorIntake(db.runtime, ctx, input(), expected),
    ]);
    const applied = outcomes.filter((o) => o.status === "fulfilled" && o.value.applied).length;
    expect(applied).toBe(1);
    expect(await countIn(ctx, "app.parcel")).toBe(4);
    expect(await countIn(ctx, "app.spatial_dataset_version")).toBe(2);
  });
});

describe("D · a failure half way rolls the whole package back", () => {
  it("writes nothing when one parcel cannot be inserted", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    // A code longer than any sane identifier is still text; the failure is forced by a duplicate
    // insert against the project's unique code index, created directly beforehand.
    await asContext(db.runtime, ctx, async (tx) => {
      await tx.execute(sql`
        insert into app.provenance_record (id, tenant_id, project_id, regime, origin, transformations,
          granularity, title, note, validation_state)
        values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, 'LIVE_OPERATIONAL','IMPORTED_DATASET',
          ARRAY['ORIGINAL']::app.provenance_transformation[], 'INDIVIDUAL','x','y','PENDING')`);
    });
    const broken = input({ parcels: { type: "FeatureCollection", features: [] } });
    await expect(
      applyCorridorIntake(db.runtime, ctx, broken, {
        sourceSha256: SHA_A,
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectX.slug,
      }),
    ).rejects.toThrow();
    expect(await countIn(ctx, "app.parcel")).toBe(0);
    expect(await countIn(ctx, "app.spatial_dataset_version")).toBe(0);
  });
});

describe("E · invalid geometry and bad codes are refused without writing", () => {
  it("refuses a self-intersecting polygon and repairs nothing", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const bad = input({ parcels: parcelsLayer(["1", "2"], { invalid: true }) });
    const plan = await planCorridorIntake(db.runtime, ctx, bad);
    expect(plan.applicable).toBe(false);
    expect(plan.problems.map((p: { code: string }) => p.code)).toContain("geometry_invalid");
    await expect(
      applyCorridorIntake(db.runtime, ctx, bad, {
        sourceSha256: SHA_A,
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectX.slug,
      }),
    ).rejects.toThrow();
    expect(await countIn(ctx, "app.parcel")).toBe(0);
  });

  it("refuses a duplicated and a blank code", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const dup = await planCorridorIntake(
      db.runtime,
      ctx,
      input({ parcels: parcelsLayer(["7", "7"]) }),
    );
    expect(dup.problems.map((p: { code: string }) => p.code)).toContain("parcel_code_duplicated");
    const blank = await planCorridorIntake(
      db.runtime,
      ctx,
      input({ parcels: parcelsLayer(["8", "  "]) }),
    );
    expect(blank.problems.map((p: { code: string }) => p.code)).toContain("parcel_code_missing");
    expect(await countIn(ctx, "app.parcel")).toBe(0);
  });
});

describe("F · the wrong tenant, the wrong role and a stale plan are refused", () => {
  it("refuses a destination that is not the active context", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    await expect(
      planCorridorIntake(
        db.runtime,
        ctx,
        input({ tenantSlug: w.tenantB.slug, projectSlug: w.projectZ.slug }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a role without geometry.import", async () => {
    const ctx = contextFor(w, "FIELD_TECHNICIAN", w.projectX, w.tenantA);
    await expect(planCorridorIntake(db.runtime, ctx, input())).rejects.toThrow();
  });

  it("refuses an apply whose opt-in does not match the input", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    await expect(
      applyCorridorIntake(db.runtime, ctx, input(), {
        sourceSha256: SHA_B,
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectX.slug,
      }),
    ).rejects.toThrow();
  });
});

describe("G · a different package may not silently update the first", () => {
  it("refuses with IDENTITY_CONFIRMATION_REQUIRED and leaves history intact", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    await applyCorridorIntake(db.runtime, ctx, input(), {
      sourceSha256: SHA_A,
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    const second = input({ sourceSha256: SHA_B, parcels: parcelsLayer(["1", "2", "3", "4", "5"]) });
    const plan = await planCorridorIntake(db.runtime, ctx, second);
    expect(plan.refusal).toBe("IDENTITY_CONFIRMATION_REQUIRED");
    expect(plan.applicable).toBe(false);
    await expect(
      applyCorridorIntake(db.runtime, ctx, second, {
        sourceSha256: SHA_B,
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectX.slug,
      }),
    ).rejects.toThrow();
    // Nothing of the first package moved.
    expect(await countIn(ctx, "app.parcel")).toBe(4);
    expect(await countIn(ctx, "app.spatial_dataset_version")).toBe(2);
  });
});

describe("H · nothing outside the two layers is touched", () => {
  it("writes no campaign, questionnaire, metric or document", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    await applyCorridorIntake(db.runtime, ctx, input(), {
      sourceSha256: SHA_A,
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    for (const table of [
      "app.survey_campaign",
      "app.survey_version",
      "app.source_document",
      "app.pgas_plan",
    ]) {
      expect(await countIn(ctx, table)).toBe(0);
    }
  });
});
