import { describe, expect, it } from "vitest";

import {
  assertPublishablePayload,
  assertPublishableRegime,
  CLIENT_PUBLICATION_SCHEMA_VERSION,
  clientPublicationPayloadSchema,
  findForbiddenConcepts,
  InvalidInput,
  publicationDigest,
  publicationVersionLabel,
  PUBLICATION_WITHHELD_FIGURES,
  PUBLIC_FACT_KEYS,
  type ClientPublicationPayload,
} from "../src/index";

const payload = (over: Partial<ClientPublicationPayload> = {}): ClientPublicationPayload => ({
  schemaVersion: CLIENT_PUBLICATION_SCHEMA_VERSION,
  project: {
    name: "Vía de prueba",
    officialTitle: null,
    locality: "Cantón de prueba",
    programmeReference: null,
  },
  summary: {
    headline: "Resumen del estudio.",
    facts: [
      {
        key: "corridor_length_km",
        label: "Longitud del corredor",
        value: "7,4",
        unit: "km",
        basis: "Eje vial delimitado por el estudio.",
      },
    ],
  },
  territory: {
    alignment: {
      label: "Eje vial",
      geometry: { type: "LineString", coordinates: [] },
    },
    influenceAreas: [],
    note: "Generalizado para su representación.",
  },
  participation: { facts: [], note: null },
  managementPlan: null,
  milestones: [],
  deliverables: [],
  forecast: null,
  notes: [],
  ...over,
});

describe("what a client publication may contain", () => {
  it("accepts a payload built from the study's own aggregates", () => {
    expect(() => assertPublishablePayload(payload())).not.toThrow();
  });

  it("has nowhere to put an individual record: unknown keys are refused, not dropped", () => {
    const smuggled = { ...payload(), respondents: [{ name: "…" }] };
    expect(() => clientPublicationPayloadSchema.parse(smuggled)).toThrow();
  });

  it("refuses a figure whose key is not in the published vocabulary", () => {
    const invented = payload();
    const facts = [{ ...invented.summary.facts[0]!, key: "affected_parcels" }];
    expect(() =>
      assertPublishablePayload({ ...invented, summary: { ...invented.summary, facts } }),
    ).toThrow();
    expect(PUBLIC_FACT_KEYS).not.toContain("affected_parcels" as never);
  });

  it("refuses a forbidden concept smuggled into free text", () => {
    const withNote = payload({
      notes: ["Revisado por el técnico responsable del levantamiento."],
    });
    expect(() => assertPublishablePayload(withNote)).toThrow(InvalidInput);
  });

  it("finds forbidden concepts wherever they are, keys or values", () => {
    expect(findForbiddenConcepts({ ok: "todo bien" })).toEqual([]);
    expect(findForbiddenConcepts({ parcelCode: "P-0001" })).toContain("parcelcode");
    expect(findForbiddenConcepts({ note: "hallazgo humanReview pendiente" })).toContain(
      "humanreview",
    );
    // The regime vocabulary itself is forbidden: it is internal language, and a payload that
    // mentions it has either leaked a facet or is describing one to a reader who cannot use it.
    expect(findForbiddenConcepts({ note: "DEMO_SIMULATION" })).toContain("demo_simulation");
  });

  it("refuses a forecast outright, because none has been approved for publication (D-019)", () => {
    const withForecast = payload({
      forecast: {
        statement: "Cierre proyectado.",
        calculatedAt: "2026-09-01T00:00:00.000Z",
        algorithmVersion: "v1",
        assumptions: ["media móvil de 5 días"],
      },
    });
    expect(() => assertPublishablePayload(withForecast)).toThrow(InvalidInput);
  });
});

describe("which regimes may reach a client", () => {
  const figure = { figure: "Predios frentistas", aggregate: true, declaredSafe: true };

  it("publishes the concluded study's own aggregates", () => {
    expect(() => assertPublishableRegime("HISTORICAL_OBSERVED", figure)).not.toThrow();
  });

  it("never publishes a simulation, whatever else is true", () => {
    expect(() => assertPublishableRegime("DEMO_SIMULATION", figure)).toThrow(InvalidInput);
    expect(() =>
      assertPublishableRegime("DEMO_SIMULATION", {
        figure: "x",
        aggregate: true,
        declaredSafe: true,
      }),
    ).toThrow(/publication_refuses_simulation/);
  });

  it("publishes live data only when it is aggregate and declared safe", () => {
    expect(() =>
      assertPublishableRegime("LIVE_OPERATIONAL", { ...figure, aggregate: false }),
    ).toThrow(InvalidInput);
    expect(() =>
      assertPublishableRegime("LIVE_OPERATIONAL", { ...figure, declaredSafe: false }),
    ).toThrow(InvalidInput);
    expect(() => assertPublishableRegime("LIVE_OPERATIONAL", figure)).not.toThrow();
  });
});

describe("the figures deliberately not published", () => {
  it("names the affected-parcel count and says why it is withheld", () => {
    const withheld = PUBLICATION_WITHHELD_FIGURES.find((f) => f.key === "affected_parcels");
    expect(withheld).toBeDefined();
    expect(withheld!.reason).toMatch(/revisión/i);
  });

  it("names the simulated field operation", () => {
    expect(PUBLICATION_WITHHELD_FIGURES.map((f) => f.key)).toContain("field_operation_progress");
  });
});

describe("versions", () => {
  it("labels a sequence the way the rest of the product does", () => {
    expect(publicationVersionLabel(1)).toBe("v1");
    expect(publicationVersionLabel(12)).toBe("v12");
  });

  it("gives the same digest to the same content, whatever the key order", () => {
    const a = payload();
    const b = payload();
    expect(publicationDigest(a)).toBe(publicationDigest(b));
    expect(publicationDigest(a)).not.toBe(
      publicationDigest(payload({ notes: ["Una nota nueva."] })),
    );
  });
});
