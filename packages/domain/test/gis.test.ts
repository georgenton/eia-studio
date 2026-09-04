import { describe, expect, it } from "vitest";

import {
  affectationRatio,
  assertActivationIsValid,
  CORRIDOR_GENERATOR_VERSION,
  corridorGeneratorInputSchema,
  deriveLayerLegend,
  LAYER_LEGEND_COPY,
  DESIGN_SURVEY_STATES_PENDING_FIELD,
  formatChainage,
  generateCorridor,
  isParcelCode,
  PARCEL_STATUS_PRESENTATION,
  PARCEL_STATUSES,
  ANALYSIS_CRS_CONTRACT,
  CANONICAL_SRID,
  epsgLabel,
  LAYER_LEGEND_ORDER,
  orderLayersForLegend,
  parseChainage,
  PRESENTATION_SRID,
  selectLayerByKind,
  sridSchema,
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

  it("does not call a consultancy's own survey layer official cadastre", () => {
    /*
     * The distinction is the `ANONYMIZED` facet, and it is not a technicality. A layer whose
     * attributes had to be stripped before it could be stored carried owner names, deeds and field
     * notes — a registry extract does not hand those out, a surveyor's working file does. Calling
     * it "official cadastre" would put a registry's authority behind a sketch (ADR-023).
     */
    expect(
      deriveLayerLegend(
        "parcels",
        facets({
          regime: "HISTORICAL_OBSERVED",
          origin: "IMPORTED_DATASET",
          transformations: ["ORIGINAL", "ANONYMIZED"],
        }),
      ),
    ).toBe("IMPORTED_STUDY_LAYER");
  });

  it("an influence area is what the study drew, whatever its regime or origin", () => {
    for (const f of [
      facets(),
      facets({ regime: "HISTORICAL_OBSERVED", origin: "IMPORTED_DATASET" }),
      facets({ regime: "LIVE_OPERATIONAL", origin: "FIELD_CAPTURE" }),
    ]) {
      expect(deriveLayerLegend("influence_areas", f)).toBe("STUDY_DELIMITED_AREA");
    }
  });

  it("every legend key the derivation can return has copy", () => {
    // A key without copy renders as an empty badge on a map that is required to carry one
    // (invariant 13), and the omission is invisible until a reviewer looks at the legend.
    for (const key of Object.keys(LAYER_LEGEND_COPY)) {
      expect(LAYER_LEGEND_COPY[key as keyof typeof LAYER_LEGEND_COPY].label.length).toBeGreaterThan(
        0,
      );
      expect(LAYER_LEGEND_COPY[key as keyof typeof LAYER_LEGEND_COPY].note.length).toBeGreaterThan(
        0,
      );
    }
    expect(Object.keys(LAYER_LEGEND_COPY)).toHaveLength(8);
  });
});

describe("layer selection is by kind, never by position (IG2-007)", () => {
  const layers = [
    { datasetKind: "alignment" as const, legend: "RECONSTRUCTED_ALIGNMENT" as const },
    { datasetKind: "parcels" as const, legend: "SYNTHETIC_PARCELS" as const },
    { datasetKind: "affectations" as const, legend: "SYNTHETIC_PARCELS" as const },
  ];

  it("returns the same layer whatever order the database gave them in", () => {
    const orders = [
      layers,
      [...layers].reverse(),
      [layers[2]!, layers[0]!, layers[1]!],
      [layers[1]!, layers[2]!, layers[0]!],
    ];
    for (const order of orders) {
      expect(selectLayerByKind(order, "parcels")?.datasetKind).toBe("parcels");
      expect(selectLayerByKind(order, "alignment")?.datasetKind).toBe("alignment");
    }
  });

  it("returns null rather than a plausible wrong layer when the kind is absent", () => {
    // The regression: the territorial summary fell back to layers[0] and captioned a parcel count
    // with the alignment's legend.
    const withoutParcels = layers.filter((l) => l.datasetKind !== "parcels");
    expect(selectLayerByKind(withoutParcels, "parcels")).toBeNull();
    expect(selectLayerByKind([], "parcels")).toBeNull();
  });

  it("orders the legend by reading order, not by row order", () => {
    for (const order of [layers, [...layers].reverse(), [layers[1]!, layers[0]!, layers[2]!]]) {
      expect(orderLayersForLegend(order).map((l) => l.datasetKind)).toEqual([
        "alignment",
        "parcels",
        "affectations",
      ]);
    }
    expect([...LAYER_LEGEND_ORDER]).toEqual(["alignment", "parcels", "affectations"]);
  });

  it("does not mutate the array it was given", () => {
    const original = [...layers].reverse();
    const copy = [...original];
    orderLayersForLegend(original);
    expect(original).toEqual(copy);
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
  it("derives the share from the two areas, in square metres", () => {
    expect(affectationRatio(1000, 10_000)).toBeCloseTo(0.1, 10);
    expect(affectationRatio(0, 10_000)).toBe(0);
    expect(affectationRatio(10_000, 10_000)).toBe(1);
    expect(affectationRatio(9_999, 10_000)).toBeCloseTo(0.9999, 10);
  });

  it("throws rather than clamping, because every invalid case is a bug the database forbids", () => {
    // parcel_geometry_area_positive
    expect(() => affectationRatio(100, 0)).toThrow(/positive/);
    expect(() => affectationRatio(100, -1)).toThrow(/positive/);
    // affectation_area_non_negative
    expect(() => affectationRatio(-1, 10_000)).toThrow(/non-negative/);
    // the affectation_within_parcel constraint trigger
    expect(() => affectationRatio(20_000, 10_000)).toThrow(/cannot exceed/);
    // A clamped 1,0 would look exactly like a genuine total affectation.
    expect(() => affectationRatio(Number.NaN, 10_000)).toThrow();
    expect(() => affectationRatio(100, Number.NaN)).toThrow();
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
  it("has exactly one CRS constant, and it is not a projected zone", () => {
    // The regression this guards: 0009 typed every geometry column as `geometry(...,32717)`,
    // which made one pilot's UTM zone a property of the platform. Canonical storage is 4326 and
    // is also what MapLibre consumes, so reads need no transform.
    expect(CANONICAL_SRID).toBe(4326);
    expect(PRESENTATION_SRID).toBe(CANONICAL_SRID);
  });

  it("keeps the pilot's UTM zone out of the domain entirely", async () => {
    // A project outside zone 17S must be storable, so 32717 may not appear as a constant here.
    const crs = await import("../src/gis/crs");
    for (const value of Object.values(crs)) {
      expect(value).not.toBe(32717);
    }
  });

  it("never classifies a CRS from its number", () => {
    // The regression (IG2-009). An SRID is an identifier; its value encodes nothing about the
    // coordinate system. The rule this replaces read the 4xxx block as "geographic", which is
    // wrong in both directions:
    //   EPSG:4087 is projected and metre-based, inside that block;
    //   EPSG:6318 is geographic and degree-based, outside it.
    // Both of these parse here, because the *shape* is all a number can tell us. Whether either
    // may be used for analysis is decided from the CRS definition, in the application layer and
    // in the database, and is asserted in the integration suite.
    for (const srid of [4087, 6318, 4326, 32717, 32718, 2225, 900913]) {
      expect(sridSchema.safeParse(srid).success, `EPSG:${srid}`).toBe(true);
    }
    // No upper bound either: a custom SRS registered in spatial_ref_sys may use any code.
    expect(sridSchema.safeParse(1_000_000).success).toBe(true);
  });

  it("still refuses values that are not SRIDs at all", () => {
    expect(sridSchema.safeParse(0).success).toBe(false);
    expect(sridSchema.safeParse(-32717).success).toBe(false);
    expect(sridSchema.safeParse(32.7).success).toBe(false);
    expect(sridSchema.safeParse("32717").success).toBe(false);
  });

  it("states the analysis-CRS contract this product actually supports", () => {
    expect(ANALYSIS_CRS_CONTRACT).toBe("projected + metre-based");
  });

  it("derives the CRS label instead of mapping codes to names", () => {
    expect(epsgLabel(32717)).toBe("EPSG:32717");
    expect(epsgLabel(CANONICAL_SRID)).toBe("EPSG:4326");
  });
});
