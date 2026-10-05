import { DOCUMENT_PROCESSING_STATES } from "@eia/domain";
import { describe, expect, it } from "vitest";

import { showsExtractionRetry } from "../lib/document-retry";

/**
 * When the document page offers *Procesar de nuevo*.
 *
 * The rule is small and the reason it is tested at all is that getting it wrong is invisible: a
 * control shown for `READY` would invite a reader to ask for a second reading the use-case
 * refuses, and a control missing for `FAILED` is the gap this wave exists to close — the action
 * and both languages' copy had been there since ADR-033 and nothing ever called them.
 *
 * Visibility is not authorization. The action re-resolves surface access and the use-case behind
 * it requires `documents.write`, so these cases are about what a reader *sees*, never about what
 * a request can do.
 */
describe("offering a document version to be read again", () => {
  it("offers it for a version that could not be read", () => {
    expect(showsExtractionRetry("FAILED", true)).toBe(true);
  });

  it("offers it for a scan, whose text this product will not invent", () => {
    expect(showsExtractionRetry("REQUIRES_OCR", true)).toBe(true);
  });

  it("does not offer it for a version already read", () => {
    // Chunks are immutable; a second reading of the same bytes would make every citation of the
    // first ambiguous (ADR-033), and the use-case refuses it.
    expect(showsExtractionRetry("READY", true)).toBe(false);
  });

  it("does not offer it while the answer is to wait", () => {
    expect(showsExtractionRetry("QUEUED", true)).toBe(false);
    expect(showsExtractionRetry("PROCESSING", true)).toBe(false);
  });

  it("does not offer it for a version nobody has asked about yet", () => {
    // `UPLOADED` is accepted by the use-case and deliberately not offered here: it is not a dead
    // end, it is a question nobody has asked (TD-124).
    expect(showsExtractionRetry("UPLOADED", true)).toBe(false);
  });

  it("offers it to nobody without documents.write", () => {
    for (const state of DOCUMENT_PROCESSING_STATES) {
      expect(showsExtractionRetry(state, false)).toBe(false);
    }
  });

  it("decides for every state the database can hold, and invents none", () => {
    // If a state is added to the enum, this fails until somebody has decided which side it is on,
    // rather than defaulting it to hidden and leaving another dead end nobody notices.
    const offered = DOCUMENT_PROCESSING_STATES.filter((state) => showsExtractionRetry(state, true));
    expect([...offered].sort()).toEqual(["FAILED", "REQUIRES_OCR"]);
    expect(DOCUMENT_PROCESSING_STATES).toHaveLength(6);
  });
});
