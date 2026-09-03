import { z } from "zod";

import { InvalidInput } from "../core/errors";
import {
  citationFor,
  resolveCitedIndices,
  type Citation,
  type RetrievedPassage,
} from "./retrieval";

/**
 * The assistant: a question, the passages that bear on it, and — when a model is available — a
 * paragraph that says what they say.
 *
 * ## Retrieval is the product; prose is the garnish
 *
 * The two halves are separable on purpose. Finding the right three paragraphs in a study's file and
 * citing them by document, version and page is most of the value, and it needs no model at all. The
 * narrative sentence needs one, and where none is configured the surface says so and shows the
 * passages. That is why `answerFromPassages` can produce a useful `AssistantAnswer` with
 * `narrative: null` rather than failing.
 *
 * ## What the model is and is not allowed to do
 *
 * It is given the retrieved passages, numbered, and asked to write from them and cite by index. It
 * has no tools, no retrieval of its own, no browsing and no writes. An index it did not receive is
 * a **failed** answer, never a dropped citation: dropping one leaves the sentence standing and
 * looking sourced, which is the failure that makes a citing assistant worse than none.
 *
 * ## Prompt injection
 *
 * The passages are the project's own documents, and a document can contain text addressed at a
 * model. It arrives inside a delimited block, the instruction says nothing inside it can change the
 * task, and — the part that actually holds — the model has no capability to grant: no tool, no
 * permission, no write path. The worst a hostile paragraph can achieve is a wrong sentence beside
 * correct citations a reader can check.
 */
export const ASSISTANT_PROMPT_VERSION = "document-assistant@1";

export interface AssistantAnswer {
  readonly question: string;
  /** Null when no generator is configured: the passages still stand on their own. */
  readonly narrative: string | null;
  readonly citations: ReadonlyArray<Citation>;
  /** Why there is no narrative, when there is none. Shown to the reader, not swallowed. */
  readonly narrativeUnavailable: string | null;
}

/** What the generator must return. Deliberately small: prose, and which passages it used. */
export const assistantOutputSchema = z
  .object({
    answer: z.string().trim().min(1).max(2000),
    citedPassages: z.array(z.number().int().min(0)).min(1).max(10),
  })
  .strict();
export type AssistantOutput = z.infer<typeof assistantOutputSchema>;

export interface AssistantGenerator {
  readonly kind: string;
  generate(input: {
    readonly question: string;
    readonly passages: ReadonlyArray<RetrievedPassage>;
    readonly model: string;
    readonly abortSignal?: AbortSignal;
  }): Promise<AssistantOutput>;
}

/** The answer when nothing was found. It says so, and cites nothing. */
export function noEvidenceAnswer(question: string): AssistantAnswer {
  return {
    question,
    narrative: null,
    citations: [],
    narrativeUnavailable:
      "No se encontraron pasajes del expediente relacionados con esta pregunta. El asistente " +
      "responde únicamente a partir de los documentos del proyecto: cuando no hay evidencia, no " +
      "hay respuesta.",
  };
}

/** The answer when passages were found but no generator is configured. */
export function passagesOnlyAnswer(
  question: string,
  passages: ReadonlyArray<RetrievedPassage>,
  reason: string,
): AssistantAnswer {
  return {
    question,
    narrative: null,
    citations: passages.map(citationFor),
    narrativeUnavailable: reason,
  };
}

/**
 * Turn a generator's output into an answer, refusing anything it cannot ground.
 *
 * Validation is not a formality here. The two things checked — that the prose is non-empty and that
 * every cited index was actually retrieved — are the two ways a citing assistant lies.
 */
export function answerFromPassages(
  question: string,
  passages: ReadonlyArray<RetrievedPassage>,
  raw: unknown,
): AssistantAnswer {
  if (passages.length === 0) {
    throw new InvalidInput("an answer cannot be generated from no passages");
  }
  const parsed = assistantOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidInput(
      `the assistant returned something the answer schema refuses: ${parsed.error.issues
        .map((issue) => issue.path.join(".") || "(root)")
        .join(", ")}`,
    );
  }
  const cited = resolveCitedIndices(parsed.data.citedPassages, passages);
  return {
    question,
    narrative: parsed.data.answer,
    citations: cited.map(citationFor),
    narrativeUnavailable: null,
  };
}
