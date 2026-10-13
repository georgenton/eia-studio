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

/** Plan, read it, and hand its fingerprint to apply — the two-step the operator performs. */
async function approvedPlan(ctx: RequestContext, i: CorridorIntakeInput): Promise<string> {
  return (await planCorridorIntake(db.runtime, ctx, i)).fingerprint;
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

    const result = await applyCorridorIntake(
      db.runtime,
      ctx,
      input(),
      await approvedPlan(ctx, input()),
    );
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
    const codesInput = input({ parcels: parcelsLayer(["001", "002"]) });
    await applyCorridorIntake(db.runtime, ctx, codesInput, await approvedPlan(ctx, codesInput));
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
    const r = await applyCorridorIntake(db.runtime, ctx, input(), await approvedPlan(ctx, input()));
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
    const expected = await approvedPlan(ctx, input());
    const first = await applyCorridorIntake(db.runtime, ctx, input(), expected);
    const idsBefore = await asContext(db.runtime, ctx, async (tx) =>
      (
        await tx.execute<{ id: string }>(sql`select id from app.parcel order by parcel_code`)
      ).rows.map((r) => r.id),
    );
    /*
     * Re-applying means planning again. The fingerprint covers the destination's version state,
     * so the plan approved before the import no longer describes the project afterwards — which
     * is the point of including it. The fresh plan is the one that says "already here".
     */
    const replan = await planCorridorIntake(db.runtime, ctx, input());
    expect(replan.reusesExistingVersions).toBe(true);
    const second = await applyCorridorIntake(db.runtime, ctx, input(), replan.fingerprint);
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
    const expected = await approvedPlan(ctx, input());
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

describe("D · a failure after the first activation rolls the whole package back", () => {
  it("leaves no parcel, no version and no activation behind", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const withActivation = input({ activate: true });
    const fp = await approvedPlan(ctx, withActivation);

    /*
     * The failure has to land *after* something has been activated, or this proves nothing: an
     * empty layer that fails validation never writes, and calling that a rollback would be a test
     * agreeing with itself. A deferred constraint trigger on the second activation's table fires
     * at the first write that follows the first activation, inside the same transaction.
     */
    await db.migrator.execute(sql`
      create or replace function app.eia_test_block_parcel_activation() returns trigger
      language plpgsql as $$
      begin
        if NEW.is_active then
          raise exception 'induced failure after the first activation';
        end if;
        return NEW;
      end $$;
      create trigger eia_test_block_parcel_activation
        before update on app.parcel_geometry
        for each row execute function app.eia_test_block_parcel_activation();`);
    try {
      /*
       * The ordering is proven by where the trigger sits, not by the message: it fires on
       * `parcel_geometry` being activated, which is the *second* activation, so the axis version
       * had already been activated in this transaction when it raised. The driver wraps the
       * message, so the assertion is that it rejected at all — the rollback below is the claim.
       */
      await expect(applyCorridorIntake(db.runtime, ctx, withActivation, fp)).rejects.toThrow();
    } finally {
      await db.migrator.execute(sql`
        drop trigger if exists eia_test_block_parcel_activation on app.parcel_geometry;
        drop function if exists app.eia_test_block_parcel_activation();`);
    }

    // Everything the transaction had already done — including the axis it activated — is gone.
    expect(await countIn(ctx, "app.parcel")).toBe(0);
    expect(await countIn(ctx, "app.parcel_geometry")).toBe(0);
    expect(await countIn(ctx, "app.alignment")).toBe(0);
    expect(await countIn(ctx, "app.spatial_dataset_version")).toBe(0);
  });

  it("activation is opt-in: without it the versions are prepared and inactive", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const r = await applyCorridorIntake(db.runtime, ctx, input(), await approvedPlan(ctx, input()));
    expect(r.activations).toEqual([]);
    const active = await asContext(
      db.runtime,
      ctx,
      async (tx) =>
        (
          await tx.execute<{ n: number }>(
            sql`select count(*)::int as n from app.spatial_dataset_version where is_active`,
          )
        ).rows[0]?.n,
    );
    expect(active).toBe(0);
  });

  it("with activation, both versions become active in the same transaction", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const i = input({ activate: true });
    const r = await applyCorridorIntake(db.runtime, ctx, i, await approvedPlan(ctx, i));
    expect(r.activations).toHaveLength(2);
    const active = await asContext(
      db.runtime,
      ctx,
      async (tx) =>
        (
          await tx.execute<{ n: number }>(
            sql`select count(*)::int as n from app.spatial_dataset_version where is_active`,
          )
        ).rows[0]?.n,
    );
    expect(active).toBe(2);
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
      applyCorridorIntake(db.runtime, ctx, bad, await approvedPlan(ctx, bad)),
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
    await expect(applyCorridorIntake(db.runtime, ctx, input(), "f".repeat(64))).rejects.toThrow();
  });
});

describe("G · a different package may not silently update the first", () => {
  it("refuses with IDENTITY_CONFIRMATION_REQUIRED and leaves history intact", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    await applyCorridorIntake(db.runtime, ctx, input(), await approvedPlan(ctx, input()));
    const second = input({ sourceSha256: SHA_B, parcels: parcelsLayer(["1", "2", "3", "4", "5"]) });
    const plan = await planCorridorIntake(db.runtime, ctx, second);
    expect(plan.refusal).toBe("IDENTITY_CONFIRMATION_REQUIRED");
    expect(plan.applicable).toBe(false);
    await expect(applyCorridorIntake(db.runtime, ctx, second, "f".repeat(64))).rejects.toThrow();
    // Nothing of the first package moved.
    expect(await countIn(ctx, "app.parcel")).toBe(4);
    expect(await countIn(ctx, "app.spatial_dataset_version")).toBe(2);
  });
});

describe("H · nothing outside the two layers is touched", () => {
  it("writes no campaign, questionnaire, metric or document", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    await applyCorridorIntake(db.runtime, ctx, input(), await approvedPlan(ctx, input()));
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

describe("the plan is an approval, not a restatement of the input", () => {
  it("A · the fingerprint is stable across identical plans and PLAN still writes nothing", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const one = await planCorridorIntake(db.runtime, ctx, input());
    const two = await planCorridorIntake(db.runtime, ctx, input());
    expect(one.fingerprint).toBe(two.fingerprint);
    expect(one.fingerprint).toHaveLength(64);
    expect(await countIn(ctx, "app.parcel")).toBe(0);
    expect(await countIn(ctx, "app.spatial_dataset_version")).toBe(0);
  });

  it("B · apply without an approved fingerprint is refused", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    await expect(applyCorridorIntake(db.runtime, ctx, input(), "")).rejects.toThrow(
      /fingerprint of an approved plan/,
    );
    await expect(applyCorridorIntake(db.runtime, ctx, input(), "f".repeat(64))).rejects.toThrow(
      /STALE_OR_UNAPPROVED_PLAN/,
    );
    expect(await countIn(ctx, "app.parcel")).toBe(0);
  });

  it("C · the declared source hash is unchanged but the layer bytes are not", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const reviewed = input();
    const fp = await approvedPlan(ctx, reviewed);
    // Same sourceSha256, same destination — a different polygon. The declaration did not change;
    // the data did, and that is exactly what a text field cannot notice.
    const edited = input({ parcels: parcelsLayer(["1", "2", "3", "9"]) });
    await expect(applyCorridorIntake(db.runtime, ctx, edited, fp)).rejects.toThrow(
      /STALE_OR_UNAPPROVED_PLAN/,
    );
    expect(await countIn(ctx, "app.parcel")).toBe(0);
  });

  it("the fingerprint also moves when the destination changes underneath", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const fp = await approvedPlan(ctx, input());
    await applyCorridorIntake(db.runtime, ctx, input(), fp);
    // The same plan, approved before the import existed, no longer describes this destination.
    await expect(applyCorridorIntake(db.runtime, ctx, input(), fp)).rejects.toThrow(
      /STALE_OR_UNAPPROVED_PLAN/,
    );
  });
});

describe("half an import is not a no-op", () => {
  it("D · one version present reports INCOMPLETE_IMPORT_STATE", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    await applyCorridorIntake(db.runtime, ctx, input(), await approvedPlan(ctx, input()));
    // Remove one half, as a crashed earlier run would have left it.
    await db.migrator.execute(sql`
      delete from app.alignment;
      delete from app.spatial_dataset_version where version_label like 'alignment_intake_%';`);
    const plan = await planCorridorIntake(db.runtime, ctx, input());
    expect(plan.reusesExistingVersions).toBe(false);
    expect(plan.refusal).toBe("INCOMPLETE_IMPORT_STATE");
    expect(plan.problems.map((p: { code: string }) => p.code)).toContain("incomplete_import_state");
    expect(plan.applicable).toBe(false);
  });
});

describe("G · a second axis is refused rather than silently dropped", () => {
  it("names both features and writes nothing", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const two = input({
      alignment: {
        type: "FeatureCollection",
        features: [...alignmentLayer.features, ...alignmentLayer.features],
      },
    });
    const plan = await planCorridorIntake(db.runtime, ctx, two);
    expect(plan.problems.map((p: { code: string }) => p.code)).toContain("multiple_alignments");
    expect(plan.applicable).toBe(false);
    await expect(applyCorridorIntake(db.runtime, ctx, two, plan.fingerprint)).rejects.toThrow();
    expect(await countIn(ctx, "app.alignment")).toBe(0);
  });
});

describe("H · the boolean alone does not lift the identity block", () => {
  it("a different package is still refused with identityConfirmedForNewPackage true", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    await applyCorridorIntake(db.runtime, ctx, input(), await approvedPlan(ctx, input()));
    const different = input({
      sourceSha256: SHA_B,
      parcels: parcelsLayer(["1", "2", "3", "4", "5"]),
      identityConfirmedForNewPackage: true,
    });
    const plan = await planCorridorIntake(db.runtime, ctx, different);
    expect(plan.refusal).toBe("IDENTITY_CONFIRMATION_REQUIRED");
    expect(plan.applicable).toBe(false);
    // The first package is untouched.
    expect(await countIn(ctx, "app.parcel")).toBe(4);
  });
});

/**
 * The defect this suite was written for, before it was fixed.
 *
 * A version's identity was its **label**, and the label was built from `sourceSha256` — the hash
 * an operator *declares* for the archive. Nothing persisted said which bytes had actually been
 * imported. So editing one coordinate, keeping the declaration, and planning *afresh* produced a
 * plan whose fingerprint matched its own input and whose labels matched the stored versions: the
 * import answered "already here" about geometry it had never seen.
 *
 * A stale plan was never the issue; this path uses a new one.
 */
describe("content, not the label an operator typed", () => {
  it("refuses a changed polygon that keeps the declared source hash", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);

    const a = input();
    await applyCorridorIntake(db.runtime, ctx, a, await approvedPlan(ctx, a));
    expect(await countIn(ctx, "app.parcel")).toBe(4);
    expect(await countIn(ctx, "app.spatial_dataset_version")).toBe(2);

    // One coordinate moves. `sourceSha256` is left exactly as it was.
    const moved = parcelsLayer(["1", "2", "3", "4"]);
    const ring = (moved.features[0] as { geometry: { coordinates: number[][][] } }).geometry
      .coordinates[0] as number[][];
    (ring[0] as number[])[0] = (ring[0] as number[])[0]! + 0.0004;
    const b = input({ parcels: moved });
    expect(b.sourceSha256).toBe(a.sourceSha256);

    // A brand-new plan over the changed bytes — not the one approved before.
    const planB = await planCorridorIntake(db.runtime, ctx, b);
    expect(planB.reusesExistingVersions).toBe(false);
    expect(planB.refusal).toBe("IMPORT_CONTENT_MISMATCH");
    expect(planB.applicable).toBe(false);

    await expect(applyCorridorIntake(db.runtime, ctx, b, planB.fingerprint)).rejects.toThrow(
      /IMPORT_CONTENT_MISMATCH/,
    );

    // The first package is untouched: same parcels, same versions, no third version.
    expect(await countIn(ctx, "app.parcel")).toBe(4);
    expect(await countIn(ctx, "app.spatial_dataset_version")).toBe(2);
  });
});

describe("a stored version that cannot prove what it holds", () => {
  it("5 · an unreadable note denies the no-op rather than being guessed at", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const a = input();
    await applyCorridorIntake(db.runtime, ctx, a, await approvedPlan(ctx, a));
    // As a version written by an older contract, or by hand, would look.
    await db.migrator.execute(
      sql`update app.spatial_dataset_version set note = 'imported from somewhere'
           where version_label like 'parcels_intake_%'`,
    );
    const plan = await planCorridorIntake(db.runtime, ctx, a);
    expect(plan.reusesExistingVersions).toBe(false);
    expect(plan.refusal).toBe("IMPORT_CONTENT_MISMATCH");
    expect(plan.problems.map((p: { code: string }) => p.code)).toContain("import_content_mismatch");
  });

  it("6 · a count that disagrees with the geometry attached to it is refused", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const a = input();
    await applyCorridorIntake(db.runtime, ctx, a, await approvedPlan(ctx, a));
    // One geometry row disappears, as a partially rolled back run would leave it.
    await db.migrator.execute(sql`
      delete from app.parcel_geometry
       where id = (select id from app.parcel_geometry limit 1)`);
    const plan = await planCorridorIntake(db.runtime, ctx, a);
    expect(plan.reusesExistingVersions).toBe(false);
    expect(plan.refusal).toBe("IMPORT_CONTENT_MISMATCH");
  });

  it("8 · an invalid input never reads as 'already imported'", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const a = input();
    await applyCorridorIntake(db.runtime, ctx, a, await approvedPlan(ctx, a));
    const bad = input({ parcels: parcelsLayer(["1", "2", "3", "4"], { invalid: true }) });
    const plan = await planCorridorIntake(db.runtime, ctx, bad);
    expect(plan.reusesExistingVersions).toBe(false);
    expect(plan.applicable).toBe(false);
    expect(plan.problems.map((p: { code: string }) => p.code)).toContain("geometry_invalid");
    await expect(applyCorridorIntake(db.runtime, ctx, bad, plan.fingerprint)).rejects.toThrow();
  });
});

describe("metadata an operator read in the plan is part of what they approved", () => {
  const cases: ReadonlyArray<readonly [string, Partial<CorridorIntakeInput>]> = [
    ["9 · sourceLabel", { sourceLabel: "otro-paquete.rar" }],
    ["10 · receivedAt", { receivedAt: "2026-01-01T00:00:00Z" }],
    ["11 · alignmentLabel", { alignmentLabel: "Otro eje" }],
  ];
  for (const [name, change] of cases) {
    it(`${name} changed after the plan is STALE_OR_UNAPPROVED_PLAN`, async () => {
      const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
      const approved = await approvedPlan(ctx, input());
      await expect(applyCorridorIntake(db.runtime, ctx, input(change), approved)).rejects.toThrow(
        /STALE_OR_UNAPPROVED_PLAN/,
      );
      expect(await countIn(ctx, "app.parcel")).toBe(0);
    });
  }
});

describe("12 · a genuine repeat keeps every identity", () => {
  it("same Parcel.id, same versions, no new geometry and no new provenance", async () => {
    const ctx = contextFor(w, "GIS_SPECIALIST", w.projectX, w.tenantA);
    const a = input();
    await applyCorridorIntake(db.runtime, ctx, a, await approvedPlan(ctx, a));

    const snapshot = async () =>
      asContext(db.runtime, ctx, async (tx) => ({
        parcels: (
          await tx.execute<{ id: string }>(sql`select id from app.parcel order by parcel_code`)
        ).rows.map((r) => r.id),
        versions: (
          await tx.execute<{ id: string; note: string }>(
            sql`select id, note from app.spatial_dataset_version order by version_label`,
          )
        ).rows,
        geometries: (
          await tx.execute<{ n: number }>(sql`select count(*)::int as n from app.parcel_geometry`)
        ).rows[0]?.n,
        provenance: (
          await tx.execute<{ n: number }>(sql`select count(*)::int as n from app.provenance_record`)
        ).rows[0]?.n,
      }));

    const before = await snapshot();
    const replan = await planCorridorIntake(db.runtime, ctx, a);
    expect(replan.reusesExistingVersions).toBe(true);
    const second = await applyCorridorIntake(db.runtime, ctx, a, replan.fingerprint);
    expect(second.noop).toBe(true);

    const after = await snapshot();
    expect(after.parcels).toEqual(before.parcels);
    expect(after.versions).toEqual(before.versions);
    expect(after.geometries).toBe(before.geometries);
    // A no-op writes no provenance either: nothing happened, so nothing is recorded as having.
    expect(after.provenance).toBe(before.provenance);
  });
});
