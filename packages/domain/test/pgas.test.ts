import { describe, expect, it } from "vitest";

import {
  headingVariants,
  measureCode,
  pgasChapterSchema,
  planCompleteness,
  planSlug,
  repeatedStatedNumbers,
  type PgasMeasure,
  type PgasPlan,
} from "../src/index";

const measure = (over: Partial<PgasMeasure> = {}): PgasMeasure => ({
  statedNumber: "01",
  programmeTitle: "PROGRAMA DE MANEJO DE PRODUCTOS QUÍMICOS",
  programmeOrdinal: 1,
  aspect: "Uso de productos químicos",
  impact: "Alteración de la calidad del suelo",
  measure: "Almacenar en área impermeabilizada y con cubeto de contención.",
  indicator: "(áreas con cubeto / áreas de almacenamiento) × 100",
  verification: "Registro fotográfico y acta de inspección",
  responsible: "Contratista",
  frequency: "Mensual",
  deadline: "1 año",
  ...over,
});

const plan = (over: Partial<PgasPlan> = {}): PgasPlan => ({
  title: "PLAN DE PREVENCIÓN Y MITIGACIÓN DE IMPACTOS",
  code: "PPMI-01",
  objective: "OBJETIVO: Implementar acciones y medidas de prevención.",
  place: null,
  columns: [
    "N°",
    "ASPECTO AMBIENTAL",
    "IMPACTO IDENTIFICADO",
    "MEDIDAS PROPUESTAS",
    "INDICADORES",
    "MEDIO DE VERIFICACIÓN",
    "RESPONSABLE",
    "FRENCUENCIA",
    "PLAZO",
  ],
  measures: [measure()],
  ...over,
});

/**
 * The management plan reads a document, and these are the tests that keep it honest about one:
 * an identifier this product minted is distinguishable from the consultancy's, absence is counted
 * rather than judged, and the document's own inconsistencies survive being read.
 */
describe("the identifier the document does not have", () => {
  it("is deterministic, so a re-import does not break a link made last month", () => {
    const input = {
      planCode: "PPMI-01",
      planTitle: "PLAN DE PREVENCIÓN Y MITIGACIÓN DE IMPACTOS",
      programmeOrdinal: 2,
      ordinal: 4,
    };
    expect(measureCode(input)).toBe("PPMI-01.02.04");
    expect(measureCode(input)).toBe(measureCode({ ...input }));
  });

  it("falls back to initials when a plan has no code, because one of the nine has none", () => {
    expect(planSlug("PLAN DE SEGURIDAD INDUSTRIAL Y SALUD OCUPACIONAL")).toBe("PSISO");
    expect(
      measureCode({
        planCode: null,
        planTitle: "5. PLAN DE SEGURIDAD INDUSTRIAL Y SALUD OCUPACIONAL",
        programmeOrdinal: 1,
        ordinal: 12,
      }),
    ).toBe("PSISO.01.12");
  });

  it("never collides between two plans of the same chapter", () => {
    const codes = new Set<string>();
    for (const [planIndex, planCode] of ["PPMI-01", "PMD-01", null].entries()) {
      for (let programme = 1; programme <= 3; programme += 1) {
        for (let row = 1; row <= 30; row += 1) {
          codes.add(
            measureCode({
              planCode,
              planTitle: `PLAN NÚMERO ${planIndex}`,
              programmeOrdinal: programme,
              ordinal: row,
            }),
          );
        }
      }
    }
    expect(codes.size).toBe(3 * 3 * 30);
  });
});

describe("completeness counts absence and does not judge it", () => {
  it("reports zeros for the delivered chapter's shape, which fills every column", () => {
    const result = planCompleteness(plan({ measures: [measure(), measure(), measure()] }));
    expect(result.measures).toBe(3);
    expect(result.incompleteMeasures).toBe(0);
    expect(Object.values(result.missing).every((n) => n === 0)).toBe(true);
    expect(result.hasCode).toBe(true);
  });

  it("counts each blank field separately, and the measures that carry any blank once", () => {
    const result = planCompleteness(
      plan({
        measures: [
          measure({ indicator: "", responsible: "" }),
          measure({ indicator: "   " }),
          measure(),
        ],
      }),
    );
    expect(result.missing.indicator).toBe(2);
    expect(result.missing.responsible).toBe(1);
    expect(result.missing.deadline).toBe(0);
    expect(result.incompleteMeasures).toBe(2);
  });

  it("notices a plan with no code, which the delivered chapter has exactly one of", () => {
    expect(planCompleteness(plan({ code: null })).hasCode).toBe(false);
    expect(planCompleteness(plan({ code: "  " })).hasCode).toBe(false);
  });
});

describe("the document's own inconsistencies survive being read", () => {
  it("names both spellings of a column, rather than saying the headings differ", () => {
    // The real chapter splits `RESPONSABLE` mid-word in one plan and misspells `FRENCUENCIA` in
    // eight. Both are position-wise disagreements, and the caller must be able to print each side.
    const other = [...plan().columns];
    other[6] = "RESPONSAB LE";
    other[7] = "FRECUENCIA";
    const variants = headingVariants([plan(), plan({ code: "PMD-01", columns: other })]);
    expect(variants).toEqual([
      { position: 6, spellings: ["RESPONSABLE", "RESPONSAB LE"] },
      { position: 7, spellings: ["FRENCUENCIA", "FRECUENCIA"] },
    ]);
  });

  it("says nothing when every plan names its columns the same way", () => {
    expect(headingVariants([plan(), plan({ code: "PMD-01" })])).toEqual([]);
  });

  it("finds a number the chapter uses twice, and says where", () => {
    const repeated = repeatedStatedNumbers([
      plan({ measures: [measure({ statedNumber: "01" })] }),
      plan({ code: "PMD-01", measures: [measure({ statedNumber: "01" })] }),
      plan({ code: "PC-01", measures: [measure({ statedNumber: "37" })] }),
    ]);
    expect(repeated).toEqual([{ statedNumber: "01", occurrences: ["PPMI-01", "PMD-01"] }]);
  });

  it("ignores blanks, because two unnumbered rows are not the same number twice", () => {
    expect(
      repeatedStatedNumbers([
        plan({ measures: [measure({ statedNumber: "" })] }),
        plan({ code: "PMD-01", measures: [measure({ statedNumber: "  " })] }),
      ]),
    ).toEqual([]);
  });
});

describe("the chapter schema refuses a shape this importer cannot honestly read", () => {
  const chapter = {
    source: { file: "cap-11.docx", sha256: "a".repeat(64), bytes: 1, receivedAt: "2026-09-02" },
    plans: [plan()],
  };

  it("accepts the delivered shape", () => {
    expect(() => pgasChapterSchema.parse(chapter)).not.toThrow();
  });

  it("refuses a plan with fewer than eight columns, which is not this matrix", () => {
    expect(() =>
      pgasChapterSchema.parse({
        ...chapter,
        plans: [{ ...plan(), columns: ["N°", "MEDIDA"] }],
      }),
    ).toThrow();
  });

  it("refuses a source without a hash, because the hash is what makes a re-import a no-op", () => {
    expect(() =>
      pgasChapterSchema.parse({ ...chapter, source: { ...chapter.source, sha256: "no" } }),
    ).toThrow();
  });

  it("refuses an unknown key, so a column nobody mapped cannot arrive unnoticed", () => {
    expect(() =>
      pgasChapterSchema.parse({
        ...chapter,
        plans: [{ ...plan(), presupuesto: "USD 12.000" }],
      }),
    ).toThrow();
  });
});
