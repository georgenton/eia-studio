import { describe, expect, it } from "vitest";

import {
  answerFromPassages,
  assertDocumentCode,
  assertIngestable,
  chunkDocument,
  CHUNKING_STRATEGY,
  citationFor,
  contentHash,
  DocumentContainsPii,
  InvalidInput,
  nextVersionLabel,
  noEvidenceAnswer,
  passagesOnlyAnswer,
  renderCitation,
  resolveCitedIndices,
  RETRIEVAL_SEMANTICS,
  type RetrievedPassage,
} from "../src/index";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const passage = (n: number, text = `Pasaje ${n}`): RetrievedPassage => ({
  chunkId: uuid(n),
  documentId: uuid(100 + n),
  documentCode: `DOC-00${n}`,
  documentTitle: `Documento ${n}`,
  documentVersionId: uuid(200 + n),
  versionLabel: "v1",
  ordinal: n,
  pageFrom: n,
  pageTo: n,
  text,
  score: 1 / n,
});

/**
 * The two things this layer has to get right are the two ways a citing assistant lies: a citation
 * that points somewhere else than it says, and a sentence that looks sourced and is not.
 */
describe("chunking is deterministic, and its boundaries are ones a reader recognises", () => {
  const pages = [
    {
      number: 1,
      text:
        "TÍTULO DEL DOCUMENTO\n\n" +
        "Primer párrafo con suficiente extensión para constituir por sí mismo una unidad de " +
        "evidencia razonable dentro del expediente y ser citado como tal.\n\n" +
        "Segundo párrafo, igualmente extenso, que describe el alcance del levantamiento realizado " +
        "y las fuentes empleadas para su elaboración.",
    },
    {
      number: 2,
      text:
        "Tercer párrafo en la segunda página, con la extensión necesaria para no fundirse con el " +
        "anterior y poder citarse de manera independiente.",
    },
  ];

  it("produces the same chunks for the same text, every time", () => {
    const first = chunkDocument(pages);
    const second = chunkDocument(pages);
    expect(second).toEqual(first);
    // The strategy is versioned, and the version travels with the document version.
    expect(CHUNKING_STRATEGY).toMatch(/@\d+$/);
  });

  it("numbers chunks from zero and records the page each one sits on", () => {
    const chunks = chunkDocument(pages);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, index) => index));
    expect(chunks[0]!.pageFrom).toBe(1);
    expect(chunks[chunks.length - 1]!.pageTo).toBe(2);
  });

  it("hashes each chunk's own words, so identical passages are identifiable", () => {
    const chunks = chunkDocument(pages);
    for (const chunk of chunks) expect(chunk.contentHash).toBe(contentHash(chunk.text));
    expect(new Set(chunks.map((c) => c.contentHash)).size).toBe(chunks.length);
  });

  it("never emits an empty chunk, whatever the whitespace", () => {
    const chunks = chunkDocument([
      {
        number: 1,
        text: "\n\n\n   \n\nUn único párrafo con contenido real y suficiente longitud.\n\n\n",
      },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text.trim()).toBe(chunks[0]!.text);
  });

  it("splits a paragraph that would be too long to read as a quote", () => {
    const long = `${"Una oración de longitud media que se repite. ".repeat(120)}`;
    const chunks = chunkDocument([{ number: 1, text: long }]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1700);
  });

  it("refuses a document with no text rather than producing zero chunks", () => {
    expect(() => chunkDocument([])).toThrow(InvalidInput);
    expect(() => chunkDocument([{ number: 1, text: "   \n\n  " }])).toThrow(/no text/);
  });

  it("keeps a short trailing fragment as evidence rather than as its own chunk", () => {
    const chunks = chunkDocument([
      {
        number: 1,
        text:
          "Un párrafo con la extensión suficiente para superar el mínimo y constituir un pasaje " +
          "citable por sí mismo dentro del expediente.\n\nCorto.",
      },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain("Corto.");
  });
});

describe("a document that may contain personal data is refused, not redacted", () => {
  it("refuses before anything is written", () => {
    expect(() => assertIngestable({ code: "DOC-001", containsPii: true })).toThrow(
      DocumentContainsPii,
    );
    // The refusal says why, and names the pipeline that does not exist.
    expect(() => assertIngestable({ code: "DOC-001", containsPii: true })).toThrow(
      /deidentification pipeline/,
    );
  });

  it("allows one that does not", () => {
    expect(() => assertIngestable({ code: "DOC-001", containsPii: false })).not.toThrow();
  });
});

describe("codes and version labels", () => {
  it("a document code looks like DOC-001", () => {
    expect(() => assertDocumentCode("DOC-001")).not.toThrow();
    for (const bad of ["DOC-1", "doc-001", "D-001", "DOC001", ""]) {
      expect(() => assertDocumentCode(bad), bad).toThrow(InvalidInput);
    }
  });

  it("the next version label follows the same convention as surveys and taxonomies", () => {
    expect(nextVersionLabel([])).toBe("v1");
    expect(nextVersionLabel(["v1"])).toBe("v2");
    expect(nextVersionLabel(["v1", "v2", "v10"])).toBe("v11");
    // A label nobody can parse does not block the next one.
    expect(nextVersionLabel(["borrador", "v3"])).toBe("v4");
  });
});

describe("a citation names a version, and quotes rather than paraphrases", () => {
  it("carries the version, and the page only when the passage sits on one", () => {
    const single = citationFor(passage(3));
    expect(single.versionLabel).toBe("v1");
    expect(single.page).toBe(3);
    expect(single.passage).toBe(4); // ordinal 3, rendered 1-based
    expect(renderCitation(single)).toBe("DOC-003 v1 · p. 3 · pasaje 4");

    const spanning = citationFor({ ...passage(4), pageFrom: 4, pageTo: 5 });
    expect(spanning.page).toBeNull();
    expect(renderCitation(spanning)).toBe("DOC-004 v1 · pasaje 5");
  });

  it("quotes the passage's own words", () => {
    const source = passage(1, "Se identifican 71 predios con afectación.");
    expect(citationFor(source).quote).toBe(source.text);
  });
});

describe("an answer may cite only what was actually retrieved", () => {
  const passages = [passage(1), passage(2), passage(3)];

  it("resolves the indices it was given, in order, without duplicates", () => {
    const resolved = resolveCitedIndices([2, 0, 2], passages);
    expect(resolved.map((p) => p.documentCode)).toEqual(["DOC-003", "DOC-001"]);
  });

  it("refuses an index that was never retrieved, rather than dropping it", () => {
    // Dropping it would leave the sentence standing and looking sourced, which is the failure that
    // makes a citing assistant worse than none.
    expect(() => resolveCitedIndices([0, 7], passages)).toThrow(/was not retrieved/);
    expect(() => resolveCitedIndices([], passages)).toThrow(/at least one/);
  });

  it("builds an answer from a well-formed generator output", () => {
    const answer = answerFromPassages("¿Cuántos predios?", passages, {
      answer: "El expediente declara dos cifras distintas.",
      citedPassages: [0, 1],
    });
    expect(answer.narrative).toContain("dos cifras");
    expect(answer.citations).toHaveLength(2);
    expect(answer.narrativeUnavailable).toBeNull();
  });

  it("refuses an output the schema does not accept", () => {
    for (const raw of [
      { answer: "", citedPassages: [0] },
      { answer: "x", citedPassages: [] },
      { answer: "x" },
      { answer: "x", citedPassages: [0], extra: true },
      "no soy un objeto",
    ]) {
      expect(() => answerFromPassages("p", passages, raw), JSON.stringify(raw)).toThrow(
        InvalidInput,
      );
    }
  });

  it("refuses to generate an answer from no passages at all", () => {
    expect(() => answerFromPassages("p", [], { answer: "x", citedPassages: [0] })).toThrow(
      /no passages/,
    );
  });
});

describe("the answers that need no model", () => {
  it("no evidence says so, and cites nothing", () => {
    const answer = noEvidenceAnswer("¿Qué dice sobre X?");
    expect(answer.citations).toHaveLength(0);
    expect(answer.narrative).toBeNull();
    expect(answer.narrativeUnavailable).toMatch(/no hay evidencia|No se encontraron/);
  });

  it("passages without a generator are still a complete answer", () => {
    const answer = passagesOnlyAnswer("¿Y esto?", [passage(1), passage(2)], "sin generador");
    expect(answer.citations).toHaveLength(2);
    expect(answer.narrative).toBeNull();
    expect(answer.narrativeUnavailable).toBe("sin generador");
  });
});

describe("the retrieval strategy is described honestly", () => {
  it("full-text says it matches words, not meaning", () => {
    const semantics = RETRIEVAL_SEMANTICS["full-text"];
    expect(semantics.label).toBe("Búsqueda léxica");
    expect(semantics.help).toMatch(/palabras/);
    expect(semantics.help).toMatch(/no por su significado/);
    // It must not claim to be semantic, or to rank by relevance in the model sense.
    expect(semantics.help.toLowerCase()).not.toContain("semántic");
  });
});
