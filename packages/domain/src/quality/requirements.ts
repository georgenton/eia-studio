import { InvalidInput } from "../core/errors";
import type { FindingSeverity, FindingType } from "./finding";

/**
 * The rule catalogue: every quality requirement the product ships, declared once (ADR-020).
 *
 * It is **code, not a table**. A rule version is a definition *and* an implementation, and putting
 * the definition in a `jsonb` column while the comparison lives in TypeScript gives one rule two
 * homes that nothing keeps in agreement. Making the column authoritative instead means writing an
 * interpreter for it — a small untyped language with its own versioning and no compiler — which is
 * the generic rule engine this slice is explicitly not building.
 *
 * A finding stores `requirementKey` and `requirementVersion` as text, so it names exactly the rule
 * that produced it and that rule is readable in the repository at the commit the run happened on.
 *
 * ## The language rule is part of the definition
 *
 * Copy templates live here because they are the finding's words, and those words are governed:
 * *possible inconsistency*, *missing information*, *potential mismatch*, *insufficient evidence*,
 * *specialist review required*. Never *incumplimiento*, *infracción*, *error detectado*,
 * *no conforme*, *el sistema determina*. `tooling/scripts/check-quality-language.mjs` fails the
 * build on the forbidden set, and a domain test asserts the templates against it too, because a
 * lint that only runs on staged files is one `git add -A` away from being skipped.
 *
 * ## Versioning
 *
 * Change what a rule *means* — its comparison, its inputs, its severity — and its version label
 * changes with it. Fixing a typo in copy does not. Findings already raised keep the label they
 * were raised with; a re-run under a new label raises new findings rather than mutating old ones,
 * because a decision somebody made was made about the old rule.
 */
export interface QualityRequirement {
  /** Stable identity, e.g. `rule.affectation_count`. Never renamed; retired instead. */
  readonly key: string;
  /** Bumped when the rule's meaning changes. Recorded on every finding it raises. */
  readonly version: string;
  readonly type: FindingType;
  readonly defaultSeverity: FindingSeverity;
  /**
   * True when settling this finding needs a second discipline — a legal conclusion contrasted
   * with social records, for instance. The rule sets the flag; a person still decides.
   */
  readonly interdisciplinaryByDefault: boolean;
  /** Shown in the catalogue and in the finding's "why flagged". */
  readonly title: string;
  readonly what: string;
  /** Why the rule looked: the reason this comparison matters to a study. */
  readonly whyFlagged: string;
  /** A human task, written as one. Never an instruction to the system. */
  readonly suggestedAction: string;
}

/**
 * The pilot rule set.
 *
 * Five rules, each one drawn from a real inconsistency in the concluded study's corpus rather than
 * invented to fill a category. Nothing about the pilot's project, province or figures appears
 * here: the rules describe *shapes* of disagreement, and the values they compare come from the
 * project's own data and fixture (CLAUDE.md rule 3).
 */
export const QUALITY_REQUIREMENTS: ReadonlyArray<QualityRequirement> = [
  {
    key: "rule.affectation_count",
    version: "1",
    type: "NUMERICAL_MISMATCH",
    defaultSeverity: "high",
    interdisciplinaryByDefault: false,
    title: "Número de predios afectados",
    what: "Dos documentos del expediente declaran totales distintos de predios con afectación.",
    whyFlagged:
      "El total de predios afectados sostiene el presupuesto de indemnizaciones y el alcance de la consulta. Dos cifras distintas para el mismo universo hacen que ambas queden en duda.",
    suggestedAction:
      "Contrastar los dos documentos y determinar cuál de las dos cifras rige. Corregir la otra en una nueva versión del documento, dejando constancia del criterio.",
  },
  {
    key: "rule.territorial_institution",
    version: "1",
    type: "GEOGRAPHICAL_MISMATCH",
    defaultSeverity: "high",
    interdisciplinaryByDefault: false,
    title: "Institución ajena al territorio del proyecto",
    what: "El expediente menciona una institución de una jurisdicción distinta a la del proyecto.",
    whyFlagged:
      "Una institución de otra provincia en un documento del expediente sugiere texto reutilizado de otro estudio. Afecta a la validez de lo que ese apartado afirma sobre este territorio.",
    suggestedAction:
      "Verificar si la mención corresponde a este proyecto. Si procede de otro expediente, corregir el apartado y revisar qué más pudo copiarse con él.",
  },
  {
    key: "rule.consultation_planned_vs_actual",
    version: "1",
    type: "TEMPORAL_MISMATCH",
    defaultSeverity: "medium",
    interdisciplinaryByDefault: false,
    title: "Fecha de consulta planificada frente a la realizada",
    what: "La fecha de la consulta que consta en la planificación no coincide con la fecha en que se realizó.",
    whyFlagged:
      "Una diferencia entre lo planificado y lo ejecutado no es por sí misma un problema: los procesos participativos se reprograman. Se señala para que quede trazada y explicada en el expediente, no para calificarla.",
    suggestedAction:
      "Registrar el motivo de la reprogramación y comprobar que la convocatoria y el acta corresponden a la fecha realizada.",
  },
  {
    key: "rule.vulnerability_conclusion",
    version: "1",
    type: "CROSS_DOCUMENT_INCONSISTENCY",
    defaultSeverity: "high",
    interdisciplinaryByDefault: true,
    title: "Conclusión sobre grupos vulnerables frente al capítulo social",
    what: "Un documento del expediente concluye que no hay grupos en situación de vulnerabilidad, mientras que el capítulo social del mismo expediente reporta casos.",
    whyFlagged:
      "Los dos apartados describen la misma población. Requiere revisión de especialista: puede tratarse de definiciones distintas de vulnerabilidad, de un alcance temporal distinto, o de una conclusión que el capítulo social no sostiene. El sistema no determina cuál.",
    suggestedAction:
      "Revisión interdisciplinaria entre el área social y la legal: contrastar la definición usada en cada documento y dejar constancia del criterio que rige.",
  },
  {
    key: "rule.pgas_place_vs_influence_area",
    version: "1",
    type: "GEOGRAPHICAL_MISMATCH",
    defaultSeverity: "medium",
    interdisciplinaryByDefault: false,
    title: "Área de aplicación del plan frente a la cartografía",
    what: "Un plan de manejo declara aplicarse en un área de influencia que la cartografía del proyecto no contiene.",
    whyFlagged:
      "Una medida se ejecuta y se fiscaliza sobre un área concreta. Si el plan la nombra y la cartografía no la delimita, no hay forma de saber dónde debe aplicarse ni de verificar después que se aplicó allí.",
    suggestedAction:
      "Contrastar el capítulo del plan con las capas entregadas: o el plan nombra un área que debe delimitarse, o la cartografía la tiene con otro nombre. Dejar constancia de cuál de las dos rige.",
  },
  {
    key: "rule.project_identity",
    version: "1",
    type: "CROSS_DOCUMENT_INCONSISTENCY",
    defaultSeverity: "medium",
    interdisciplinaryByDefault: false,
    title: "Identificación del proyecto en el expediente",
    what: "Un identificador del proyecto que consta en el expediente no coincide con el declarado en la ficha del proyecto.",
    whyFlagged:
      "Nombre, ubicación y código identifican el expediente ante la autoridad. Una discrepancia entre documentos del mismo expediente deja sin resolver a qué proyecto se refiere cada uno.",
    suggestedAction:
      "Verificar el identificador correcto con la ficha del proyecto y unificar las menciones en una nueva versión del documento.",
  },
];

const BY_KEY = new Map(QUALITY_REQUIREMENTS.map((r) => [r.key, r]));

export function requirementByKey(key: string): QualityRequirement {
  const requirement = BY_KEY.get(key);
  if (!requirement) throw new InvalidInput(`unknown quality requirement: ${key}`);
  return requirement;
}

export function requirementKeys(): ReadonlyArray<string> {
  return QUALITY_REQUIREMENTS.map((r) => r.key);
}

/**
 * The vocabulary rule of invariant 11, as data.
 *
 * The forbidden words are not stylistic preferences. Each one asserts something a rule comparing
 * two values is not entitled to assert: that a legal obligation was breached, that one of the two
 * values is the error, or that the system reached a conclusion. The Quality Gate detects
 * disagreement; a person decides what it means.
 */
export const FORBIDDEN_FINDING_WORDS: ReadonlyArray<string> = [
  "incumplimiento",
  "incumple",
  "infracción",
  "infraccion",
  "error detectado",
  "no conforme",
  "no cumple",
  "el sistema determina",
  "el sistema concluye",
  "ilegal",
  "sanción",
  "sancion",
];

/** Phrases the approved copy uses instead, kept here so the two lists live together. */
export const PERMITTED_FINDING_PHRASES: ReadonlyArray<string> = [
  "posible inconsistencia",
  "no coincide",
  "información faltante",
  "requiere revisión de especialista",
  "evidencia insuficiente",
];

/** Throws on the first forbidden word. Used by the domain test and by the copy lint. */
export function assertPermittedFindingLanguage(text: string, where: string): void {
  const haystack = text.toLowerCase();
  for (const word of FORBIDDEN_FINDING_WORDS) {
    if (haystack.includes(word)) {
      throw new InvalidInput(
        `${where} uses "${word}", which states a conclusion the Quality Gate may not reach ` +
          "(invariant 11, ADR-008 §5).",
      );
    }
  }
}
