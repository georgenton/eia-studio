import { describe, expect, it } from "vitest";

import {
  detectPgasPlaceVsInfluenceArea,
  assertComparable,
  assertPermittedFindingLanguage,
  availableDecisions,
  decideFinding,
  detectAffectationCount,
  detectPlannedVsActual,
  detectProjectIdentity,
  detectTerritorialInstitution,
  detectVulnerabilityConclusion,
  evidenceLocatorSchema,
  findingFingerprint,
  FORBIDDEN_FINDING_WORDS,
  InvalidInput,
  QUALITY_REQUIREMENTS,
  requirementByKey,
  type Evidence,
  type FindingState,
} from "../src/index";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/**
 * The Quality Gate's one job is to be believed, and everything here is about that.
 *
 * A rule that fires when the sources agree, a finding that shows one side of a comparison, a
 * decision that could be edited afterwards, or copy that calls a discrepancy a breach — each is a
 * different way of losing the same thing.
 */
describe("a rule fires only when the sources actually disagree", () => {
  const anexo = { value: 71, sourceRef: "Anexo de afectaciones", assertionId: uuid(1) };
  const informe = (value: number) => ({
    value,
    sourceRef: "Informe social",
    assertionId: uuid(20),
  });

  it("says nothing when the two documents state the same total", () => {
    expect(detectAffectationCount({ first: anexo, second: informe(71) })).toBeNull();
  });

  it("raises a finding when they differ, and names both figures", () => {
    const finding = detectAffectationCount({ first: anexo, second: informe(70) });
    expect(finding).not.toBeNull();
    expect(finding!.explanation).toContain("71");
    expect(finding!.explanation).toContain("70");
    // Neither figure is called the error: the specialist decides which source governs.
    expect(finding!.explanation).not.toMatch(/incorrect|erróne|error/i);
    // Both sides are documents. The pilot's parcel layer is synthetic and is never compared to a
    // historical figure.
    for (const item of finding!.evidence) expect(item.locator.kind).toBe("assertion");
  });

  it("keeps the same identity when the values change, so a decision is not orphaned", () => {
    const first = detectAffectationCount({ first: anexo, second: informe(70) })!;
    const later = detectAffectationCount({ first: anexo, second: informe(68) })!;
    expect(later.fingerprint).toBe(first.fingerprint);
    // …but the text does change, which is what tells the run this is new information.
    expect(later.explanation).not.toBe(first.explanation);
  });

  it("does not fire on a jurisdiction that matches, accents and case included", () => {
    expect(
      detectTerritorialInstitution({
        mentioned: {
          name: "Prefectura de Ejemplo",
          jurisdiction: "PROVINCIA DE EJEMPLO",
          sourceRef: "Informe",
          assertionId: uuid(2),
          quote: "…",
        },
        projectJurisdiction: "Provincia de Ejemplo",
      }),
    ).toBeNull();
  });

  it("fires on an institution from another jurisdiction", () => {
    const finding = detectTerritorialInstitution({
      mentioned: {
        name: "Prefectura de Otra Provincia",
        jurisdiction: "Otra Provincia",
        sourceRef: "Informe social",
        assertionId: uuid(3),
        quote: "…convenio con la Prefectura de Otra Provincia…",
      },
      projectJurisdiction: "Provincia del Proyecto",
    })!;
    expect(finding.severity).toBe("high");
    expect(finding.evidence.map((e) => e.role)).toEqual(["SOURCE_A", "SOURCE_B"]);
  });

  it("treats planned-versus-actual as traceability, not as a fault", () => {
    const finding = detectPlannedVsActual({
      event: "asamblea",
      planned: { date: "2025-10-25", sourceRef: "Plan", assertionId: uuid(4) },
      actual: { date: "2025-10-22", sourceRef: "Acta", assertionId: uuid(5) },
    })!;
    expect(finding.severity).toBe("medium");
    expect(finding.explanation).toContain("3 día(s)");
    expect(finding.explanation).toMatch(/no supone por sí misma un problema/);
  });

  it("refuses a date that is not a calendar date rather than comparing strings", () => {
    expect(() =>
      detectPlannedVsActual({
        event: "asamblea",
        planned: { date: "25/10/2025", sourceRef: "Plan", assertionId: uuid(4) },
        actual: { date: "2025-10-22", sourceRef: "Acta", assertionId: uuid(5) },
      }),
    ).toThrow(/ISO calendar/);
  });

  it("compares the vulnerability conclusion against the corpus, never against a person", () => {
    const finding = detectVulnerabilityConclusion({
      conclusion: {
        assertsNone: true,
        sourceRef: "Componente legal",
        assertionId: uuid(6),
        quote: "No se identificaron grupos en situación de vulnerabilidad.",
      },
      reportedCases: {
        value: 4,
        sourceRef: "Capítulo social",
        assertionId: uuid(7),
        quote: "4 casos registrados",
      },
    })!;
    expect(finding.interdisciplinaryRequired).toBe(true);
    // It never contradicts the legal conclusion; it says the two documents differ.
    expect(finding.explanation).toMatch(/requiere revisión de especialista/);
    expect(finding.explanation).not.toMatch(/falso|incorrecta|no es cierto/i);
    // Both sides are documents. Nothing in the evidence points at a survey response.
    for (const item of finding.evidence) expect(item.locator.kind).toBe("assertion");
  });

  it("stays quiet when the conclusion and the social chapter agree", () => {
    expect(
      detectVulnerabilityConclusion({
        conclusion: { assertsNone: true, sourceRef: "s", assertionId: uuid(6), quote: "q" },
        reportedCases: { value: 0, sourceRef: "s", assertionId: uuid(7), quote: "0" },
      }),
    ).toBeNull();
    expect(
      detectVulnerabilityConclusion({
        conclusion: { assertsNone: false, sourceRef: "s", assertionId: uuid(6), quote: "q" },
        reportedCases: { value: 4, sourceRef: "s", assertionId: uuid(7), quote: "4" },
      }),
    ).toBeNull();
  });

  it("normalises whitespace and accents before calling an identifier a mismatch", () => {
    expect(
      detectProjectIdentity({
        stated: {
          field: "Ubicación",
          value: "  Cantón  Ejemplo ",
          sourceRef: "s",
          assertionId: uuid(8),
        },
        projectValue: "Cantón Ejemplo",
        projectField: "locationLabel",
      }),
    ).toBeNull();
  });
});

describe("a finding always compares exactly two sources", () => {
  const item = (role: Evidence["role"]): Evidence => ({
    role,
    locator: { kind: "project", field: "locationLabel" },
    label: "l",
    quote: "q",
  });

  it("accepts one of each, with any amount of context", () => {
    expect(() =>
      assertComparable([item("SOURCE_A"), item("SOURCE_B"), item("CONTEXT"), item("CONTEXT")]),
    ).not.toThrow();
  });

  it("refuses one side alone: that is an assertion, not a comparison", () => {
    expect(() => assertComparable([item("SOURCE_A")])).toThrow(/exactly two sources/);
    expect(() =>
      assertComparable([item("SOURCE_A"), item("SOURCE_A"), item("SOURCE_B")]),
    ).toThrow();
  });
});

describe("evidence locators are typed, and an unknown kind is not silently accepted", () => {
  it("accepts each declared kind", () => {
    const locators = [
      { kind: "assertion", assertionId: uuid(9), sourceRef: "Informe" },
      { kind: "project", field: "locationLabel" },
      { kind: "document_version", documentVersionId: uuid(11), page: 47 },
    ];
    for (const locator of locators) {
      expect(evidenceLocatorSchema.safeParse(locator).success, JSON.stringify(locator)).toBe(true);
    }
  });

  it("rejects a kind nobody declared, and an entity outside the list", () => {
    expect(evidenceLocatorSchema.safeParse({ kind: "url", href: "http://x" }).success).toBe(false);
    // An assertion locator with an extra field is refused too: `strict()`, so a locator cannot
    // quietly grow a page number nobody produced.
    expect(
      evidenceLocatorSchema.safeParse({
        kind: "assertion",
        assertionId: uuid(12),
        sourceRef: "s",
        page: 47,
      }).success,
    ).toBe(false);
  });
});

describe("the lifecycle refuses transitions that never happened", () => {
  const justification = "Contrastado con el anexo vigente.";

  it("moves through the states the design declares", () => {
    expect(decideFinding("OPEN", { decision: "START_REVIEW", justification }).toState).toBe(
      "UNDER_REVIEW",
    );
    expect(decideFinding("UNDER_REVIEW", { decision: "ACCEPT", justification }).toState).toBe(
      "ACCEPTED",
    );
    expect(decideFinding("ACCEPTED", { decision: "RESOLVE", justification }).toState).toBe(
      "RESOLVED",
    );
    expect(decideFinding("RESOLVED", { decision: "REOPEN", justification }).toState).toBe("OPEN");
  });

  it("refuses a decision the current state does not allow", () => {
    // Resolving something nobody accepted, or dismissing something already resolved, would write a
    // history that never happened.
    expect(() => decideFinding("DISMISSED", { decision: "RESOLVE", justification })).toThrow(
      InvalidInput,
    );
    expect(() => decideFinding("OPEN", { decision: "RESOLVE", justification })).toThrow(
      /cannot be RESOLVE/,
    );
  });

  it("requires a justification that is not a token word", () => {
    for (const text of ["", "ok", "sí", "   ", "revisado"]) {
      expect(
        () => decideFinding("OPEN", { decision: "DISMISS", justification: text }),
        text,
      ).toThrow();
    }
  });

  it("only the interdisciplinary request raises the flag", () => {
    expect(
      decideFinding("OPEN", { decision: "REQUEST_INTERDISCIPLINARY", justification })
        .interdisciplinaryRequired,
    ).toBe(true);
    expect(
      decideFinding("OPEN", { decision: "ACCEPT", justification }).interdisciplinaryRequired,
    ).toBe(false);
  });

  it("offers the UI exactly the decisions the state machine will accept", () => {
    for (const state of [
      "OPEN",
      "UNDER_REVIEW",
      "ACCEPTED",
      "DISMISSED",
      "RESOLVED",
    ] as FindingState[]) {
      for (const decision of availableDecisions(state)) {
        expect(
          () => decideFinding(state, { decision, justification }),
          `${state}/${decision}`,
        ).not.toThrow();
      }
    }
  });
});

describe("a fingerprint identifies the comparison, not its values", () => {
  it("is order-insensitive and case-insensitive over its subject", () => {
    const a = findingFingerprint({
      requirementKey: "r",
      requirementVersion: "1",
      subject: ["B", "a"],
    });
    const b = findingFingerprint({
      requirementKey: "r",
      requirementVersion: "1",
      subject: ["a", "b"],
    });
    expect(a).toBe(b);
  });

  it("changes when the rule version changes, so a redefined rule raises its own finding", () => {
    const v1 = findingFingerprint({ requirementKey: "r", requirementVersion: "1", subject: ["a"] });
    const v2 = findingFingerprint({ requirementKey: "r", requirementVersion: "2", subject: ["a"] });
    expect(v1).not.toBe(v2);
  });

  it("refuses an empty subject rather than colliding every finding of a rule", () => {
    expect(() =>
      findingFingerprint({ requirementKey: "r", requirementVersion: "1", subject: ["  "] }),
    ).toThrow(InvalidInput);
  });
});

/**
 * Invariant 11, enforced rather than described.
 *
 * The forbidden words are not stylistic. Each asserts something a rule comparing two values is not
 * entitled to assert: that an obligation was breached, that one value is the error, or that the
 * system concluded anything.
 */
describe("the Quality Gate never declares compliance", () => {
  it("no requirement's copy uses a forbidden word", () => {
    for (const requirement of QUALITY_REQUIREMENTS) {
      for (const [field, text] of Object.entries({
        title: requirement.title,
        what: requirement.what,
        whyFlagged: requirement.whyFlagged,
        suggestedAction: requirement.suggestedAction,
      })) {
        expect(() =>
          assertPermittedFindingLanguage(text, `${requirement.key}.${field}`),
        ).not.toThrow();
      }
    }
  });

  it("no generated finding's text uses one either", () => {
    const generated = [
      detectAffectationCount({
        first: { value: 71, sourceRef: "s", assertionId: uuid(1) },
        second: { value: 70, sourceRef: "t", assertionId: uuid(20) },
      })!,
      detectTerritorialInstitution({
        mentioned: {
          name: "X",
          jurisdiction: "A",
          sourceRef: "s",
          assertionId: uuid(2),
          quote: "q",
        },
        projectJurisdiction: "B",
      })!,
      detectPlannedVsActual({
        event: "e",
        planned: { date: "2025-10-25", sourceRef: "s", assertionId: uuid(3) },
        actual: { date: "2025-10-22", sourceRef: "s", assertionId: uuid(4) },
      })!,
      detectVulnerabilityConclusion({
        conclusion: { assertsNone: true, sourceRef: "s", assertionId: uuid(5), quote: "q" },
        reportedCases: { value: 4, sourceRef: "s", assertionId: uuid(6), quote: "4" },
      })!,
      detectProjectIdentity({
        stated: { field: "Ubicación", value: "A", sourceRef: "s", assertionId: uuid(7) },
        projectValue: "B",
        projectField: "locationLabel",
      })!,
    ];
    for (const finding of generated) {
      expect(() =>
        assertPermittedFindingLanguage(finding.title, finding.requirementKey),
      ).not.toThrow();
      expect(() =>
        assertPermittedFindingLanguage(finding.explanation, finding.requirementKey),
      ).not.toThrow();
    }
  });

  it("catches a forbidden word wherever it appears, including mid-sentence", () => {
    for (const word of FORBIDDEN_FINDING_WORDS) {
      expect(() =>
        assertPermittedFindingLanguage(`El documento presenta ${word} grave`, "t"),
      ).toThrow(InvalidInput);
    }
  });
});

describe("the catalogue is internally consistent", () => {
  it("every rule has a unique key and a version", () => {
    const keys = QUALITY_REQUIREMENTS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const requirement of QUALITY_REQUIREMENTS) {
      expect(requirement.version, requirement.key).toMatch(/^\d+$/);
      expect(requirementByKey(requirement.key)).toBe(requirement);
    }
  });

  it("refuses a key nobody declared, rather than returning a blank rule", () => {
    expect(() => requirementByKey("rule.invented")).toThrow(InvalidInput);
  });

  it("names no pilot project, province, customer or figure", () => {
    // CLAUDE.md rule 3, asserted here because this catalogue is the file most likely to acquire
    // one: the rules were derived from a real study's inconsistencies.
    const text = JSON.stringify(QUALITY_REQUIREMENTS);
    for (const forbidden of ["Zamora", "Puente del Amor", "Pichincha", "Los Hachos", "7,4"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});

/**
 * The plan against the map (ADR-024 §5, TD-072 closed).
 *
 * Two sources — a chapter that says where a plan applies, and the geometry delivered with it. The
 * silent case is the one that matters most here: against the study as delivered this rule finds
 * nothing, and a rule that cannot be seen finding nothing is a rule nobody can trust when it does.
 */
describe("a plan's place of application against the cartography", () => {
  const areas = {
    influenceAreaKinds: ["direct", "indirect", "direct_social", "indirect_social"],
    influenceAreaLabels: [
      "Área de influencia directa — componente físico",
      "Área de influencia social directa",
    ],
  };

  it("says nothing when the plan names an area the cartography delimits", () => {
    expect(
      detectPgasPlaceVsInfluenceArea({
        plan: {
          code: "PRC-01",
          title: "PLAN DE RELACIONES COMUNITARIAS",
          place: "LUGAR DE APLICACIÓN: Área de Influencia Directa del Proyecto",
        },
        ...areas,
      }),
    ).toBeNull();
  });

  it("says nothing when the plan names no area at all", () => {
    expect(
      detectPgasPlaceVsInfluenceArea({
        plan: { code: "PPMI-01", title: "PLAN DE PREVENCIÓN", place: "Vía “Puente del Amor”" },
        ...areas,
      }),
    ).toBeNull();
  });

  it("reports it when the cartography has no such area, naming both sides", () => {
    const finding = detectPgasPlaceVsInfluenceArea({
      plan: {
        code: "PRC-01",
        title: "PLAN DE RELACIONES COMUNITARIAS",
        place: "LUGAR DE APLICACIÓN: Área de Influencia Directa del Proyecto",
      },
      influenceAreaKinds: ["indirect"],
      influenceAreaLabels: ["Área de influencia indirecta — componente físico"],
    });
    expect(finding).not.toBeNull();
    expect(finding?.requirementKey).toBe("rule.pgas_place_vs_influence_area");
    const roles = finding?.evidence.map((e) => e.role);
    expect(roles).toEqual(["SOURCE_A", "SOURCE_B"]);
    expect(finding?.evidence[0]?.locator).toMatchObject({ kind: "pgas_plan", planCode: "PRC-01" });
    expect(finding?.evidence[1]?.locator).toMatchObject({
      kind: "spatial_layer",
      layer: "influence_areas",
    });
    // Never a verdict: it says the two disagree, not which of them is wrong.
    expect(finding?.explanation).toContain("requiere revisión de especialista");
  });

  it("distinguishes the social area from the physical one", () => {
    const finding = detectPgasPlaceVsInfluenceArea({
      plan: {
        code: "PC-01",
        title: "PLAN DE CONTINGENCIAS",
        place: "Área de Influencia Social Directa",
      },
      influenceAreaKinds: ["direct"],
      influenceAreaLabels: ["Área de influencia directa — componente físico"],
    });
    // `direct` is not `direct_social`: the plan named the social area and the map has the physical.
    expect(finding).not.toBeNull();
  });
});
