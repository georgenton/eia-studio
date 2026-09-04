import {
  ClassifierUnavailable,
  narrativeOutputSchema,
  REPORT_PROMPT_VERSION,
  requireAvailableClassifier,
  type ClassifierAvailability,
  type NarrativeGenerator,
  type NarrativeOutput,
  type ReportSnapshot,
} from "@eia/domain";

/**
 * Adapters for the chapter's narrative generator.
 *
 * The same rule as every other adapter in this product (IG4-001): explicit configuration, no
 * default, no fallback in either direction, decided by the one domain function they share.
 *
 * What leaves the system here is the **snapshot** — already-computed figures with their labels and
 * bases — and nothing else. Not the responses, not the documents, not the database. That is why the
 * prompt can be short: the generator cannot introduce a number it never saw, and every number it
 * did see is checked against the section on the way back.
 */
export function renderChapterSystemPrompt(): string {
  return [
    "Redactas el capítulo social de un estudio de impacto ambiental y social, en español (Ecuador).",
    "",
    "Recibes una instantánea de cifras YA CALCULADAS. Tu tarea es redactar un párrafo por sección",
    "que las presente en prosa. No calculas nada.",
    "",
    "Reglas:",
    "- Usa únicamente las cifras de la sección. No introduzcas ninguna cifra que no esté en ella.",
    "- Menciona la base de cada porcentaje cuando la sección la declare.",
    "- No emites conclusiones de cumplimiento normativo ni calificas un hallazgo como error.",
    "- No presentas una codificación como validada si la sección dice que no hay ninguna.",
    "- Un párrafo por sección, breve y sobrio. Sin listas, sin títulos.",
  ].join("\n");
}

export function renderChapterUserPrompt(snapshot: ReportSnapshot): string {
  const sections = snapshot.sections
    .map((section) => {
      const facts = section.facts
        .map((fact) => `  - ${fact.label}: ${fact.value}${fact.basis ? ` (${fact.basis})` : ""}`)
        .join("\n");
      return `### ${section.key} — ${section.title}\n${section.summary}\n${facts}`;
    })
    .join("\n\n");
  return [
    `Proyecto: ${snapshot.projectName}`,
    `Versión del cuestionario: ${snapshot.surveyVersionLabel}`,
    `Regímenes presentes: ${snapshot.regimes.join(", ")}`,
    "",
    sections,
  ].join("\n");
}

/** The deterministic generator for tests and CI. Zero network calls. */
export interface FakeNarrativeScenario {
  readonly narrative?: string;
  readonly onlyKeys?: ReadonlyArray<string>;
  readonly failWith?: string;
  readonly malformed?: unknown;
}

export class FakeNarrativeGenerator implements NarrativeGenerator {
  readonly kind = "fake";
  constructor(private readonly scenario: FakeNarrativeScenario = {}) {}

  async generate(input: { snapshot: ReportSnapshot }): Promise<NarrativeOutput> {
    if (this.scenario.failWith) throw new ClassifierUnavailable(this.scenario.failWith, false);
    if (this.scenario.malformed !== undefined) {
      return narrativeOutputSchema.parse(this.scenario.malformed);
    }
    const keys = this.scenario.onlyKeys ?? input.snapshot.sections.map((s) => s.key);
    return narrativeOutputSchema.parse({
      sections: input.snapshot.sections
        .filter((section) => keys.includes(section.key))
        .map((section) => ({
          key: section.key,
          // Deliberately number-free unless a scenario supplies one: the grounding check is what
          // this fake exists to let a test exercise, in both directions.
          narrative:
            this.scenario.narrative ??
            `${section.summary} Los resultados se detallan en el cuadro de esta sección.`,
        })),
    });
  }
}

/** The live adapter: AI SDK through the Vercel AI Gateway, structured output, no tools. */
export class AiGatewayNarrativeGenerator implements NarrativeGenerator {
  readonly kind = "ai-gateway";

  async generate(input: {
    snapshot: ReportSnapshot;
    model: string;
    abortSignal?: AbortSignal;
  }): Promise<NarrativeOutput> {
    const { generateText, Output } = await import("ai");
    const { z } = await import("zod");

    const keys = input.snapshot.sections.map((s) => s.key);
    const schema = z.object({
      sections: z
        .array(
          z.object({
            key: z.enum(keys as [string, ...string[]]),
            narrative: z.string().min(1).max(1800),
          }),
        )
        .min(1),
    });

    try {
      const result = await generateText({
        model: input.model,
        system: renderChapterSystemPrompt(),
        prompt: renderChapterUserPrompt(input.snapshot),
        output: Output.object({ schema }),
        maxRetries: 1,
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
      });
      return narrativeOutputSchema.parse(result.output);
    } catch (error) {
      if (error instanceof ClassifierUnavailable) throw error;
      throw new ClassifierUnavailable(
        `the report generator's provider failed: ${(error as Error).message}`,
        false,
      );
    }
  }
}

export function createNarrativeGenerator(availability: ClassifierAvailability): NarrativeGenerator {
  const usable = requireAvailableClassifier(availability);
  return usable.kind === "fake" ? new FakeNarrativeGenerator() : new AiGatewayNarrativeGenerator();
}

export { REPORT_PROMPT_VERSION };
