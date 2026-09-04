import { describe, expect, it } from "vitest";

import {
  applyNarratives,
  assertNarrativeGrounded,
  assertSnapshotHonest,
  InvalidInput,
  nextReportVersionLabel,
  REPORT_PROMPT_VERSION,
  SECTION_TITLES,
  snapshotDigest,
  snapshotFacts,
  type ReportFact,
  type ReportSection,
  type ReportSnapshot,
} from "../src/index";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const metricFact = (over: Partial<ReportFact> = {}): ReportFact => ({
  key: "submitted",
  label: "Fichas enviadas",
  value: "70",
  basis: "sobre respuestas enviadas: 70",
  source: { kind: "metric", metric: "field.instances_submitted", method: "Conteo." },
  ...over,
});

const section = (over: Partial<ReportSection> = {}): ReportSection => ({
  key: "universe",
  title: SECTION_TITLES.universe,
  ordinal: 0,
  summary: "Cobertura del levantamiento.",
  facts: [metricFact()],
  ...over,
});

const snapshot = (over: Partial<ReportSnapshot> = {}): ReportSnapshot => ({
  kind: "social_chapter",
  computedAt: "2026-09-03T12:00:00.000Z",
  projectName: "Proyecto de prueba",
  surveyVersionLabel: "v1",
  sections: [section()],
  regimes: ["HISTORICAL_OBSERVED"],
  ...over,
});

/**
 * The snapshot is the deliverable (ADR-022), so these are the tests that decide whether a chapter
 * can be believed: no fact without a source, no theme figure without validated codings, no regime
 * left undeclared, and no sentence stating a number the section did not compute.
 */
describe("a fact cannot exist without a source", () => {
  it("the schema refuses one", () => {
    const bad = { ...metricFact() } as Record<string, unknown>;
    delete bad.source;
    expect(() =>
      assertSnapshotHonest(snapshot({ sections: [section({ facts: [bad as never] })] })),
    ).toThrow();
  });

  it("and refuses a source kind nobody declared", () => {
    expect(() =>
      assertSnapshotHonest(
        snapshot({
          sections: [
            section({
              facts: [metricFact({ source: { kind: "vibes", why: "parece" } as never })],
            }),
          ],
        }),
      ),
    ).toThrow();
  });

  it("every source kind the product uses is accepted", () => {
    const facts: ReportFact[] = [
      metricFact(),
      metricFact({
        key: "theme",
        value: "4",
        source: { kind: "human_review", reviews: 4, taxonomyVersionLabel: "v1" },
      }),
      metricFact({
        key: "finding",
        value: "Resuelto",
        source: { kind: "quality_finding", findingCode: "QG-001", state: "RESOLVED" },
      }),
      metricFact({
        key: "doc",
        value: "v1",
        source: {
          kind: "document_chunk",
          documentCode: "DOC-001",
          versionLabel: "v1",
          page: 1,
          chunkId: uuid(1),
        },
      }),
      metricFact({
        key: "prov",
        value: "RECONSTRUCTED",
        source: {
          kind: "provenance",
          provenanceId: uuid(2),
          facets: {
            regime: "HISTORICAL_OBSERVED",
            origin: "IMPORTED_DOCUMENT",
            transformations: ["RECONSTRUCTED"],
            granularity: "AGGREGATE",
          },
          note: "Transcripción manual.",
        },
      }),
    ];
    expect(() => assertSnapshotHonest(snapshot({ sections: [section({ facts })] }))).not.toThrow();
    expect(snapshotFacts(snapshot({ sections: [section({ facts })] }))).toHaveLength(5);
  });
});

describe("a theme figure rests on validated codings, or says nothing", () => {
  it("refuses a figure claiming a count from zero validated codings", () => {
    // The failure this prevents: a distribution computed from AI proposals and presented as the
    // chapter's finding (ADR-019, ADR-022 §5).
    expect(() =>
      assertSnapshotHonest(
        snapshot({
          sections: [
            section({
              facts: [
                metricFact({
                  key: "theme.X",
                  value: "12 (30,0 %)",
                  source: { kind: "human_review", reviews: 0, taxonomyVersionLabel: "v1" },
                }),
              ],
            }),
          ],
        }),
      ),
    ).toThrow(/report_fact_without_validation/);
  });

  it("accepts the honest empty case", () => {
    expect(() =>
      assertSnapshotHonest(
        snapshot({
          sections: [
            section({
              facts: [
                metricFact({
                  key: "theme.none",
                  value: "—",
                  source: { kind: "human_review", reviews: 0, taxonomyVersionLabel: "—" },
                }),
              ],
            }),
          ],
        }),
      ),
    ).not.toThrow();
  });
});

describe("a chapter built on simulated data says so at the top", () => {
  it("refuses a snapshot whose fact carries a regime it does not declare", () => {
    expect(() =>
      assertSnapshotHonest(
        snapshot({
          regimes: ["HISTORICAL_OBSERVED"],
          sections: [
            section({
              facts: [
                metricFact({
                  key: "prov",
                  source: {
                    kind: "provenance",
                    provenanceId: uuid(3),
                    facets: {
                      regime: "DEMO_SIMULATION",
                      origin: "SYSTEM_GENERATED",
                      transformations: ["DERIVED"],
                      granularity: "AGGREGATE",
                    },
                    note: "Simulación.",
                  },
                }),
              ],
            }),
          ],
        }),
      ),
    ).toThrow(/report_regime_undeclared/);
  });

  it("accepts it once the regime is declared", () => {
    expect(() =>
      assertSnapshotHonest(
        snapshot({
          regimes: ["DEMO_SIMULATION", "HISTORICAL_OBSERVED"],
          sections: [
            section({
              facts: [
                metricFact({
                  key: "prov",
                  source: {
                    kind: "provenance",
                    provenanceId: uuid(3),
                    facets: {
                      regime: "DEMO_SIMULATION",
                      origin: "SYSTEM_GENERATED",
                      transformations: ["DERIVED"],
                      granularity: "AGGREGATE",
                    },
                    note: "Simulación.",
                  },
                }),
              ],
            }),
          ],
        }),
      ),
    ).not.toThrow();
  });
});

describe("the digest identifies content, not the moment", () => {
  it("two generations of unchanged data produce the same digest", () => {
    const a = snapshot({ computedAt: "2026-09-03T12:00:00.000Z" });
    const b = snapshot({ computedAt: "2026-10-01T08:30:00.000Z" });
    expect(snapshotDigest(b)).toBe(snapshotDigest(a));
  });

  it("a changed figure changes it", () => {
    const changed = snapshot({ sections: [section({ facts: [metricFact({ value: "71" })] })] });
    expect(snapshotDigest(changed)).not.toBe(snapshotDigest(snapshot()));
  });

  it("key order does not, so a refactor of the builder cannot look like a changed chapter", () => {
    const original = snapshot();
    // The same content with its keys inserted in a different order. `JSON.stringify` would differ;
    // the digest must not, or every reordering of the snapshot builder would read as new data.
    const reordered = {
      regimes: original.regimes,
      sections: original.sections.map((s) => ({
        facts: s.facts,
        summary: s.summary,
        ordinal: s.ordinal,
        title: s.title,
        key: s.key,
      })),
      surveyVersionLabel: original.surveyVersionLabel,
      projectName: original.projectName,
      computedAt: original.computedAt,
      kind: original.kind,
    } as ReportSnapshot;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(original));
    expect(snapshotDigest(reordered)).toBe(snapshotDigest(original));
  });
});

describe("a paragraph may state only figures the section computed", () => {
  const withFigures = section({
    facts: [
      metricFact({ key: "a", value: "70", basis: "sobre 70 fichas enviadas" }),
      metricFact({ key: "b", value: "12,5 %", basis: null }),
    ],
  });

  it("accepts a paragraph using only those numbers", () => {
    expect(() =>
      assertNarrativeGrounded(
        withFigures,
        "Se enviaron 70 fichas, de las cuales el 12,5 % corresponde a la categoría señalada.",
      ),
    ).not.toThrow();
  });

  it("accepts a paragraph with no numbers at all", () => {
    expect(() =>
      assertNarrativeGrounded(withFigures, "Los resultados se detallan en el cuadro siguiente."),
    ).not.toThrow();
  });

  it("refuses a figure the section did not compute", () => {
    // The failure that survives review: a plausible number in a chapter, in a sentence nobody
    // checked because the ones around it were right.
    expect(() =>
      assertNarrativeGrounded(withFigures, "Se enviaron 70 fichas y se visitaron 141 predios."),
    ).toThrow(/report_narrative_ungrounded/);
  });

  it("applies narratives to the sections that exist, and refuses one that does not", () => {
    const applied = applyNarratives(snapshot({ sections: [withFigures] }), {
      sections: [{ key: "universe", narrative: "Se enviaron 70 fichas." }],
    });
    expect(applied.get("universe")).toContain("70");

    expect(() =>
      applyNarratives(snapshot({ sections: [withFigures] }), {
        sections: [{ key: "inventada", narrative: "Texto." }],
      }),
    ).toThrow(/report_narrative_unknown_section/);
  });

  it("refuses an output the schema does not accept", () => {
    for (const raw of [
      { sections: [] },
      { sections: [{ key: "universe" }] },
      { sections: [{ key: "universe", narrative: "" }] },
      { sections: [{ key: "universe", narrative: "x", extra: 1 }] },
      "no soy un objeto",
    ]) {
      expect(() => applyNarratives(snapshot(), raw), JSON.stringify(raw)).toThrow(InvalidInput);
    }
  });
});

describe("versions follow the product's one convention", () => {
  it("v1, v2, …", () => {
    expect(nextReportVersionLabel([])).toBe("v1");
    expect(nextReportVersionLabel(["v1", "v2"])).toBe("v3");
    expect(nextReportVersionLabel(["v9", "v10"])).toBe("v11");
  });

  it("the prompt is versioned, so a chapter can name what wrote it", () => {
    expect(REPORT_PROMPT_VERSION).toMatch(/@\d+$/);
  });
});
