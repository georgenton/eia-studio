import { describe, expect, it } from "vitest";

import {
  affectationRatio,
  assertActivationIsValid,
  CORRIDOR_GENERATOR_VERSION,
  corridorGeneratorInputSchema,
  deriveLayerLegend,
  DESIGN_SURVEY_STATES_PENDING_FIELD,
  formatChainage,
  generateCorridor,
  isParcelCode,
  PARCEL_STATUS_PRESENTATION,
  PARCEL_STATUSES,
  parseChainage,
  PRESENTATION_SRID,
  STORAGE_SRID,
  type CorridorGeneratorInput,
  type ProvenanceFacets,
} from "../src/index";

const INPUT: CorridorGeneratorInput = corridorGeneratorInputSchema.parse({
  seed: "test-corridor",
  controlPoints: [
    [-78.95, -4.08],
    [-78.92, -4.07],
    [-78.89, -4.06],
  ],
  parcelCount: 40,
  frontageM: 62,
  depthM: 210,
  rightOfWayHalfWidthM: 25,
  setbackM: 6,
  sectors: [
    { label: "Tramo 1", share: 0.5 },
    { label: "Tramo 2", share: 0.5 },
  ],
  codePrefix: "PRED-TST",
  statusPlan: { estimated: 2, notLocated: 1, excluded: 0 },
});

const facets = (over: Partial<ProvenanceFacets> = {}): ProvenanceFacets => ({
  regime: "DEMO_SIMULATION",
  origin: "SYSTEM_GENERATED",
  transformations: [],
  granularity: "INDIVIDUAL",
  ...over,
});

describe("parcel identity", () => {
  it("accepts the business codes the cartographer writes and rejects the rest", () => {
    expect(isParcelCode("PRED-AAA-042")).toBe(true);
    // The default `project.parcel_code_pattern` is `P-{seq:04}` (FEATURES.md §4).
    expect(isParcelCode("P-0001")).toBe(true);
    // A parcel code is not a name, not a coordinate, not lower case, not a bare number.
    expect(isParcelCode("pred-zam-042")).toBe(false);
    expect(isParcelCode("042")).toBe(false);
    expect(isParcelCode("PRED ZAM 042")).toBe(false);
    expect(isParcelCode("María Pérez")).toBe(false);
  });

  it("keeps GIS status separate from the survey states Field will own", () => {
    // The reduction is deliberate: nothing in this slice can know whether a parcel was visited.
    expect([...PARCEL_STATUSES]).toEqual(["confirmed", "estimated", "not_located", "excluded"]);
    for (const state of DESIGN_SURVEY_STATES_PENDING_FIELD) {
      expect(PARCEL_STATUSES as ReadonlyArray<string>).not.toContain(state);
    }
  });

  it("gives every status a glyph, so state never rests on colour alone", () => {
    for (const status of PARCEL_STATUSES) {
      const presentation = PARCEL_STATUS_PRESENTATION[status];
      expect(presentation.glyph.length).toBeGreaterThan(0);
      expect(presentation.label.length).toBeGreaterThan(0);
    }
  });
});

describe("chainage", () => {
  it("formats and parses the abscissa of the approved design", () => {
    expect(formatChainage(2840)).toBe("2+840");
    expect(formatChainage(31)).toBe("0+031");
    expect(parseChainage("2+840")).toBe(2840);
    expect(parseChainage("2840")).toBeNull();
    expect(parseChainage("abscisa")).toBeNull();
  });

  it("round-trips", () => {
    for (const metres of [0, 7, 999, 1000, 7407]) {
      expect(parseChainage(formatChainage(metres))).toBe(metres);
    }
  });
});

describe("layer provenance legend", () => {
  it("is derived from the facets, never stored", () => {
    expect(deriveLayerLegend("alignment", facets({ transformations: ["RECONSTRUCTED"] }))).toBe(
      "RECONSTRUCTED_ALIGNMENT",
    );
    expect(
      deriveLayerLegend(
        "alignment",
        facets({ regime: "HISTORICAL_OBSERVED", origin: "IMPORTED_DATASET" }),
      ),
    ).toBe("OFFICIAL_IMPORTED_ALIGNMENT");
    expect(deriveLayerLegend("parcels", facets())).toBe("SYNTHETIC_PARCELS");
    expect(
      deriveLayerLegend("parcels", facets({ regime: "LIVE_OPERATIONAL", origin: "FIELD_CAPTURE" })),
    ).toBe("FIELD_CAPTURED");
    expect(
      deriveLayerLegend(
        "parcels",
        facets({ regime: "HISTORICAL_OBSERVED", origin: "IMPORTED_DATASET" }),
      ),
    ).toBe("OFFICIAL_CADASTRE");
  });

  it("never labels a demo simulation as cadastre, whatever its origin claims", () => {
    expect(deriveLayerLegend("parcels", facets({ origin: "IMPORTED_DATASET" }))).toBe(
      "SYNTHETIC_PARCELS",
    );
  });
});

describe("dataset version activation", () => {
  const version = (id: string, supersedes: string | null) => ({
    id,
    datasetKind: "parcels" as const,
    supersedesVersionId: supersedes,
  });

  it("allows the first version of a kind", () => {
    expect(() =>
      assertActivationIsValid({ candidate: version("v1", null), currentActive: null }),
    ).not.toThrow();
  });

  it("requires a replacement to name the version it supersedes", () => {
    expect(() =>
      assertActivationIsValid({
        candidate: version("v2", null),
        currentActive: { id: "v1", datasetKind: "parcels" },
      }),
    ).toThrow(/supersedes/);
    expect(() =>
      assertActivationIsValid({
        candidate: version("v2", "v1"),
        currentActive: { id: "v1", datasetKind: "parcels" },
      }),
    ).not.toThrow();
  });

  it("refuses to let one kind of layer replace another", () => {
    expect(() =>
      assertActivationIsValid({
        candidate: version("v2", "v1"),
        currentActive: { id: "v1", datasetKind: "alignment" },
      }),
    ).toThrow(/same kind/);
  });
});

describe("affectation", () => {
  it("derives the share from the two areas and never exceeds the parcel", () => {
    expect(affectationRatio(1000, 10_000)).toBeCloseTo(0.1, 10);
    expect(affectationRatio(20_000, 10_000)).toBe(1);
    expect(affectationRatio(100, 0)).toBe(0);
  });
});

describe("corridor generation", () => {
  it("is deterministic: the same seed produces the same corridor", () => {
    const a = generateCorridor(INPUT);
    const b = generateCorridor(INPUT);
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
    expect(a.generatorVersion).toBe(CORRIDOR_GENERATOR_VERSION);
  });

  it("changes with the seed, so the determinism is of the algorithm and not of a constant", () => {
    const a = generateCorridor(INPUT);
    const b = generateCorridor({ ...INPUT, seed: "another-corridor" });
    expect(JSON.stringify(b)).not.toEqual(JSON.stringify(a));
    expect(b.parcels).toHaveLength(a.parcels.length);
  });

  it("produces the requested universe with codes numbered in chainage order", () => {
    const corridor = generateCorridor(INPUT);
    expect(corridor.parcels).toHaveLength(INPUT.parcelCount);
    expect(corridor.parcels[0]?.parcelCode).toBe("PRED-TST-001");
    expect(corridor.parcels.at(-1)?.parcelCode).toBe("PRED-TST-040");
    for (const parcel of corridor.parcels) expect(isParcelCode(parcel.parcelCode)).toBe(true);
    const chainages = corridor.parcels.map((p) => p.chainageM);
    expect([...chainages].sort((x, y) => x - y)).toEqual(chainages);
  });

  it("honours the status plan exactly, so the map legend's counts are not approximate", () => {
    const corridor = generateCorridor(INPUT);
    const count = (status: string) => corridor.parcels.filter((p) => p.status === status).length;
    expect(count("estimated")).toBe(2);
    expect(count("not_located")).toBe(1);
    expect(count("excluded")).toBe(0);
    expect(count("confirmed")).toBe(INPUT.parcelCount - 3);
  });

  it("emits closed rings in the presentation CRS, near the control points", () => {
    const corridor = generateCorridor(INPUT);
    for (const parcel of corridor.parcels) {
      expect(parcel.ring.length).toBeGreaterThanOrEqual(4);
      expect(parcel.ring[0]).toEqual(parcel.ring.at(-1));
      for (const [lon, lat] of parcel.ring) {
        expect(lon).toBeGreaterThan(-79.1);
        expect(lon).toBeLessThan(-78.7);
        expect(lat).toBeGreaterThan(-4.2);
        expect(lat).toBeLessThan(-3.9);
      }
    }
  });

  it("places parcels on both sides of the axis", () => {
    const sides = new Set(generateCorridor(INPUT).parcels.map((p) => p.side));
    expect(sides).toEqual(new Set(["left", "right"]));
  });

  it("keeps every parcel inside a declared sector", () => {
    const labels = new Set(INPUT.sectors.map((s) => s.label));
    for (const parcel of generateCorridor(INPUT).parcels) {
      expect(labels.has(parcel.sectorLabel)).toBe(true);
    }
  });

  it("rejects inputs the schema does not allow rather than silently clamping them", () => {
    expect(() => corridorGeneratorInputSchema.parse({ ...INPUT, parcelCount: 0 })).toThrow();
    expect(() => corridorGeneratorInputSchema.parse({ ...INPUT, controlPoints: [] })).toThrow();
    expect(() => corridorGeneratorInputSchema.parse({ ...INPUT, codePrefix: "pred" })).toThrow();
    // `strict()`: an unexpected key is a mistake, not something to ignore.
    expect(() => corridorGeneratorInputSchema.parse({ ...INPUT, extra: 1 })).toThrow();
  });
});

describe("coordinate reference systems", () => {
  it("separates the metric storage CRS from the presentation CRS", () => {
    // Areas and distances must never be computed in degrees.
    expect(STORAGE_SRID).toBe(32717);
    expect(PRESENTATION_SRID).toBe(4326);
    expect(STORAGE_SRID).not.toBe(PRESENTATION_SRID);
  });
});
