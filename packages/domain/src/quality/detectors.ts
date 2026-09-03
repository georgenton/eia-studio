import type { Evidence } from "./evidence";
import { assertComparable } from "./evidence";
import { findingFingerprint, type FindingSeverity } from "./finding";
import { requirementByKey, type QualityRequirement } from "./requirements";

/**
 * The comparisons themselves: pure functions from two values to *a finding or nothing*.
 *
 * They know nothing about the database. The application layer reads the inputs — a count from the
 * parcel layer, an assertion extracted from the corpus, the project's own declared territory — and
 * hands them here as plain values. That is what makes a rule testable by writing down the two
 * numbers, and it is why "does this rule fire?" never requires a fixture.
 *
 * Every detector returns the finding's *content* and its fingerprint. It does not decide whether
 * to insert a row, whether one already exists, or what state it should be in; deduplication and
 * lifecycle belong to the run (application layer), because they depend on what is already stored.
 */
export interface DetectedFinding {
  readonly requirementKey: string;
  readonly requirementVersion: string;
  readonly fingerprint: string;
  readonly severity: FindingSeverity;
  readonly interdisciplinaryRequired: boolean;
  /** One line, specific to this occurrence. The generic explanation lives on the requirement. */
  readonly title: string;
  readonly explanation: string;
  readonly evidence: ReadonlyArray<Evidence>;
}

function build(
  requirement: QualityRequirement,
  input: {
    readonly subject: readonly string[];
    readonly title: string;
    readonly explanation: string;
    readonly evidence: ReadonlyArray<Evidence>;
    readonly severity?: FindingSeverity;
  },
): DetectedFinding {
  assertComparable(input.evidence);
  return {
    requirementKey: requirement.key,
    requirementVersion: requirement.version,
    fingerprint: findingFingerprint({
      requirementKey: requirement.key,
      requirementVersion: requirement.version,
      subject: input.subject,
    }),
    severity: input.severity ?? requirement.defaultSeverity,
    interdisciplinaryRequired: requirement.interdisciplinaryByDefault,
    title: input.title,
    explanation: input.explanation,
    evidence: input.evidence,
  };
}

/** Spanish (es-EC) integer formatting: the locale of every string this module produces. */
const count = (value: number) => new Intl.NumberFormat("es-EC").format(value);

// -------------------------------------------------------------------------------------------
// rule.affectation_count — a declared total against a counted one
// -------------------------------------------------------------------------------------------

export interface AffectationCountInput {
  /** What one document of the expediente says, and where. */
  readonly first: {
    readonly value: number;
    readonly sourceRef: string;
    readonly assertionId: string;
  };
  /** What another document of the same expediente says. */
  readonly second: {
    readonly value: number;
    readonly sourceRef: string;
    readonly assertionId: string;
  };
}

/**
 * Two documents of one file, two totals for the same universe.
 *
 * It compares **corpus against corpus**, not corpus against the parcel layer. The pilot's layer is
 * synthetic geometry generated for the demo; comparing a real historical figure against it would
 * produce a number-shaped finding about nothing, which is precisely the failure this module cannot
 * afford. When a project has an imported cadastre, a layer-versus-document rule becomes worth
 * writing — and it will be its own requirement, with its own version.
 */
export function detectAffectationCount(input: AffectationCountInput): DetectedFinding | null {
  if (input.first.value === input.second.value) return null;
  const requirement = requirementByKey("rule.affectation_count");
  const difference = Math.abs(input.first.value - input.second.value);
  return build(requirement, {
    // The subject is the comparison, not its values: a figure corrected from 71 to 72 updates this
    // finding instead of orphaning the decision somebody already made about it.
    subject: ["affected-parcels", "declared-vs-declared"],
    title: "El número de predios afectados difiere entre dos documentos del expediente",
    explanation:
      `Un documento del expediente indica ${count(input.first.value)} predios con afectación y ` +
      `otro ${count(input.second.value)}: una diferencia de ${count(difference)}. Posible ` +
      "inconsistencia entre las dos fuentes; requiere revisión de especialista para determinar " +
      "cuál rige.",
    evidence: [
      {
        role: "SOURCE_A",
        locator: {
          kind: "assertion",
          assertionId: input.first.assertionId,
          sourceRef: input.first.sourceRef,
        },
        label: input.first.sourceRef,
        quote: `${count(input.first.value)} predios con afectación`,
      },
      {
        role: "SOURCE_B",
        locator: {
          kind: "assertion",
          assertionId: input.second.assertionId,
          sourceRef: input.second.sourceRef,
        },
        label: input.second.sourceRef,
        quote: `${count(input.second.value)} predios con afectación`,
      },
    ],
  });
}

// -------------------------------------------------------------------------------------------
// rule.territorial_institution — a name that belongs to another jurisdiction
// -------------------------------------------------------------------------------------------

export interface TerritorialInstitutionInput {
  /** The institution named in the corpus, with its jurisdiction as the corpus states it. */
  readonly mentioned: {
    readonly name: string;
    readonly jurisdiction: string;
    readonly sourceRef: string;
    readonly assertionId: string;
    readonly quote: string;
  };
  /** The project's own declared territory, from the project record. */
  readonly projectJurisdiction: string;
}

/**
 * Deterministic on purpose: it compares two declared jurisdictions, and it fires only when they
 * differ. It does not guess whether a name "looks like" it belongs elsewhere — that is the fuzzy
 * claim ADR-008 and the slice brief both refuse to turn into an automatic finding.
 */
export function detectTerritorialInstitution(
  input: TerritorialInstitutionInput,
): DetectedFinding | null {
  const normalise = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim()
      .toLowerCase();
  if (normalise(input.mentioned.jurisdiction) === normalise(input.projectJurisdiction)) return null;

  const requirement = requirementByKey("rule.territorial_institution");
  return build(requirement, {
    subject: ["institution", normalise(input.mentioned.name)],
    title: "Una institución mencionada corresponde a otra jurisdicción",
    explanation:
      `El expediente menciona «${input.mentioned.name}», de ${input.mentioned.jurisdiction}, ` +
      `mientras que el proyecto se ubica en ${input.projectJurisdiction}. Posible inconsistencia ` +
      "territorial; requiere revisión de especialista.",
    evidence: [
      {
        role: "SOURCE_A",
        locator: {
          kind: "assertion",
          assertionId: input.mentioned.assertionId,
          sourceRef: input.mentioned.sourceRef,
        },
        label: "Mención en el expediente",
        quote: input.mentioned.quote,
      },
      {
        role: "SOURCE_B",
        locator: { kind: "project", field: "locationLabel" },
        label: "Ubicación declarada del proyecto",
        quote: input.projectJurisdiction,
      },
    ],
  });
}

// -------------------------------------------------------------------------------------------
// rule.consultation_planned_vs_actual — planned against executed
// -------------------------------------------------------------------------------------------

export interface PlannedVsActualInput {
  readonly planned: {
    readonly date: string;
    readonly sourceRef: string;
    readonly assertionId: string;
  };
  readonly actual: {
    readonly date: string;
    readonly sourceRef: string;
    readonly assertionId: string;
  };
  /** What was scheduled: an assembly, a hearing. Part of the subject, so each one is its own finding. */
  readonly event: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Traceability, not a fault. Participatory processes are reprogrammed for legitimate reasons, so
 * the finding says the two dates differ and asks for the reason to be recorded — it does not call
 * the difference an error, and the copy is written so a reader cannot mistake it for one.
 */
export function detectPlannedVsActual(input: PlannedVsActualInput): DetectedFinding | null {
  if (!ISO_DATE.test(input.planned.date) || !ISO_DATE.test(input.actual.date)) {
    throw new Error("planned and actual dates must be ISO calendar dates (yyyy-mm-dd)");
  }
  if (input.planned.date === input.actual.date) return null;

  const requirement = requirementByKey("rule.consultation_planned_vs_actual");
  const days = Math.round(
    Math.abs(
      Date.parse(`${input.actual.date}T00:00:00Z`) - Date.parse(`${input.planned.date}T00:00:00Z`),
    ) / 86_400_000,
  );
  const format = (iso: string) =>
    new Intl.DateTimeFormat("es-EC", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));

  return build(requirement, {
    subject: ["consultation", input.event.toLowerCase()],
    title: "La fecha planificada y la realizada de la consulta no coinciden",
    explanation:
      `La planificación registra ${format(input.planned.date)} y la ejecución ` +
      `${format(input.actual.date)}, ${count(days)} día(s) de diferencia. Se señala para que la ` +
      "reprogramación quede trazada en el expediente; no supone por sí misma un problema.",
    evidence: [
      {
        role: "SOURCE_A",
        locator: {
          kind: "assertion",
          assertionId: input.planned.assertionId,
          sourceRef: input.planned.sourceRef,
        },
        label: "Fecha planificada",
        quote: format(input.planned.date),
      },
      {
        role: "SOURCE_B",
        locator: {
          kind: "assertion",
          assertionId: input.actual.assertionId,
          sourceRef: input.actual.sourceRef,
        },
        label: "Fecha realizada",
        quote: format(input.actual.date),
      },
    ],
  });
}

// -------------------------------------------------------------------------------------------
// rule.vulnerability_conclusion — a legal conclusion against the social records
// -------------------------------------------------------------------------------------------

export interface VulnerabilityConclusionInput {
  /** The legal chapter's conclusion, as extracted: does it assert that there are none? */
  readonly conclusion: {
    readonly assertsNone: boolean;
    readonly sourceRef: string;
    readonly assertionId: string;
    readonly quote: string;
  };
  /** The social chapter's own reported figure, from the same corpus. */
  readonly reportedCases: {
    readonly value: number;
    readonly sourceRef: string;
    readonly assertionId: string;
    readonly quote: string;
  };
}

/**
 * The one rule the brief calls semantic, kept deterministic — and kept away from personal data.
 *
 * It compares two **statements from the corpus**: a legal chapter concluding that there are no
 * groups in a situation of vulnerability, and a social chapter reporting a count of such cases.
 * Both are aggregate figures somebody wrote in a document.
 *
 * It deliberately does *not* compare the conclusion against survey records. A vulnerability
 * indicator attached to a household is special-category personal data (SECURITY.md §10, §10b), the
 * demo questionnaire is built to collect none, and adding a field so a rule could count it would
 * be exactly the "small exception for a demo" the compliance gate exists to prevent.
 *
 * It never says the conclusion is false. It says two documents describing the same population say
 * different things, and that reconciling them needs the legal and the social criteria side by
 * side — which is why this requirement is interdisciplinary by default.
 */
export function detectVulnerabilityConclusion(
  input: VulnerabilityConclusionInput,
): DetectedFinding | null {
  if (!input.conclusion.assertsNone || input.reportedCases.value === 0) return null;

  const requirement = requirementByKey("rule.vulnerability_conclusion");
  return build(requirement, {
    subject: ["vulnerability", "conclusion-vs-social-chapter"],
    title: "La conclusión sobre grupos vulnerables no coincide con el capítulo social",
    explanation:
      "Un documento del expediente concluye que no hay grupos en situación de vulnerabilidad, y " +
      `el capítulo social del mismo expediente reporta ${count(input.reportedCases.value)} caso(s). ` +
      "Puede tratarse de definiciones o alcances distintos: requiere revisión de especialista, " +
      "con criterio legal y social.",
    evidence: [
      {
        role: "SOURCE_A",
        locator: {
          kind: "assertion",
          assertionId: input.conclusion.assertionId,
          sourceRef: input.conclusion.sourceRef,
        },
        label: "Conclusión del componente legal",
        quote: input.conclusion.quote,
      },
      {
        role: "SOURCE_B",
        locator: {
          kind: "assertion",
          assertionId: input.reportedCases.assertionId,
          sourceRef: input.reportedCases.sourceRef,
        },
        label: "Casos reportados en el capítulo social",
        quote: input.reportedCases.quote,
      },
    ],
  });
}

// -------------------------------------------------------------------------------------------
// rule.project_identity — an identifier that does not match the project record
// -------------------------------------------------------------------------------------------

export interface ProjectIdentityInput {
  readonly stated: {
    readonly field: string;
    readonly value: string;
    readonly sourceRef: string;
    readonly assertionId: string;
  };
  readonly projectValue: string;
  /** The project record's field this is compared against, for the locator. */
  readonly projectField: string;
}

export function detectProjectIdentity(input: ProjectIdentityInput): DetectedFinding | null {
  const normalise = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  if (normalise(input.stated.value) === normalise(input.projectValue)) return null;

  const requirement = requirementByKey("rule.project_identity");
  return build(requirement, {
    subject: ["project-identity", input.projectField],
    title: `El expediente y la ficha del proyecto difieren en «${input.stated.field}»`,
    explanation:
      `El expediente indica «${input.stated.value}» y la ficha del proyecto «${input.projectValue}». ` +
      "Posible inconsistencia en la identificación del proyecto; requiere revisión de especialista.",
    evidence: [
      {
        role: "SOURCE_A",
        locator: {
          kind: "assertion",
          assertionId: input.stated.assertionId,
          sourceRef: input.stated.sourceRef,
        },
        label: `${input.stated.field} en el expediente`,
        quote: input.stated.value,
      },
      {
        role: "SOURCE_B",
        locator: { kind: "project", field: input.projectField },
        label: `${input.stated.field} en la ficha del proyecto`,
        quote: input.projectValue,
      },
    ],
  });
}
