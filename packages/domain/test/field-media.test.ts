import {
  assertVisitMediaWithinLimit,
  CLIENT_PUBLICATION_SCHEMA_VERSION,
  clientPublicationPayloadSchema,
  FIELD_MEDIA_KINDS,
  fieldMediaDeclarationSchema,
  InvalidInput,
  LOCAL_MEDIA_STATES,
  MAX_MEDIA_PER_VISIT,
  mayDeleteLocalFile,
  parseFieldMediaDeclaration,
} from "../src/index";
import { describe, expect, it } from "vitest";

const VALID = {
  assignmentId: "11111111-1111-4111-8111-111111111111",
  visitId: "22222222-2222-4222-8222-222222222222",
  localId: "33333333-3333-4333-8333-333333333333",
  storedObjectId: "44444444-4444-4444-8444-444444444444",
  kind: "parcel" as const,
  capturedAt: "2026-09-17T14:05:00.000Z",
  note: "Frente del predio desde la vía",
  location: { latitude: -4.0761, longitude: -78.9412, accuracyM: 8 },
};

describe("what a technician may say about a photograph", () => {
  it("accepts a declaration with everything the visit needs", () => {
    const parsed = parseFieldMediaDeclaration(VALID);
    expect(parsed.kind).toBe("parcel");
    expect(parsed.location?.accuracyM).toBe(8);
  });

  it("accepts one with no note and no location, and never invents either", () => {
    const parsed = parseFieldMediaDeclaration({ ...VALID, note: null, location: null });
    expect(parsed.note).toBeNull();
    // A device with no fix reports no fix. The alternative — a nearby point, a last known
    // position — is a coordinate nobody measured, attached to evidence.
    expect(parsed.location).toBeNull();
  });

  /*
   * The absence is the design. Photographing an identity card, a deed or a signed attendance
   * sheet produces identified personal data, and the compliance gate of SECURITY.md §10a has not
   * authorised collecting any. The honest way to not collect something is to have nowhere to put
   * it — the same argument the classifier's input type makes about respondents.
   */
  it("has no kind for a document, a signature or a person", () => {
    expect(FIELD_MEDIA_KINDS).toEqual(["parcel", "affectation", "access", "other"]);
    for (const forbidden of ["document", "signature", "identity", "person", "respondent"]) {
      expect(
        fieldMediaDeclarationSchema.safeParse({ ...VALID, kind: forbidden }).success,
        forbidden,
      ).toBe(false);
    }
  });

  it("refuses a declaration that carries a field nobody declared", () => {
    // `.strict()`: a device cannot smuggle a respondent, a parcel owner or a second coordinate in
    // beside the fields the server reads.
    expect(
      fieldMediaDeclarationSchema.safeParse({ ...VALID, respondentName: "Rosa" }).success,
    ).toBe(false);
  });

  it("refuses an id the device did not mint as a uuid", () => {
    expect(fieldMediaDeclarationSchema.safeParse({ ...VALID, localId: "photo-1" }).success).toBe(
      false,
    );
  });

  it("bounds the note, because free text beside evidence is where a name ends up", () => {
    expect(fieldMediaDeclarationSchema.safeParse({ ...VALID, note: "x".repeat(301) }).success).toBe(
      false,
    );
  });

  it("reports an invalid declaration as InvalidInput rather than a zod error", () => {
    expect(() => parseFieldMediaDeclaration({ ...VALID, kind: "signature" })).toThrow(InvalidInput);
  });
});

describe("how many photographs one visit may carry", () => {
  it("admits an ordinary visit and refuses a device looping on a broken retry", () => {
    expect(() => assertVisitMediaWithinLimit(0)).not.toThrow();
    expect(() => assertVisitMediaWithinLimit(MAX_MEDIA_PER_VISIT - 1)).not.toThrow();
    expect(() => assertVisitMediaWithinLimit(MAX_MEDIA_PER_VISIT)).toThrow(InvalidInput);
  });
});

describe("when the device may delete its only copy", () => {
  /*
   * The failure this predicate prevents cannot be undone: a technician's only copy of a photograph
   * removed because an upload *looked* finished. The bytes reaching a bucket is not the same fact
   * as the row existing, and only the second one means the evidence is kept.
   */
  it("only after the server acknowledged the row, never after the PUT", () => {
    expect(mayDeleteLocalFile({ state: "UPLOADED", serverMediaId: "m1" })).toBe(true);

    expect(mayDeleteLocalFile({ state: "UPLOADED", serverMediaId: null })).toBe(false);
    for (const state of LOCAL_MEDIA_STATES.filter((s) => s !== "UPLOADED")) {
      expect(mayDeleteLocalFile({ state, serverMediaId: "m1" }), state).toBe(false);
      expect(mayDeleteLocalFile({ state, serverMediaId: null }), state).toBe(false);
    }
  });
});

/*
 * The four prohibitions of ADR-032 §3, asserted where each is actually prevented. None of these is
 * a rule somebody has to remember: in every case the type or the query has nowhere to put a
 * photograph, and these tests fail if that ever stops being true.
 */
describe("the four places field media must never automatically go", () => {
  it("the client portal: the payload is composed and has nowhere to put a file", () => {
    const payload = {
      schemaVersion: CLIENT_PUBLICATION_SCHEMA_VERSION,
      project: {
        name: "Vía de prueba",
        officialTitle: null,
        locality: "Cantón de prueba",
        programmeReference: null,
      },
      summary: { headline: "Resumen del estudio.", facts: [] },
      territory: { alignment: null, influenceAreas: [], note: "Generalizado." },
      participation: { facts: [], note: null },
      managementPlan: null,
      milestones: [],
      deliverables: [],
      forecast: null,
      notes: [],
    };
    // The control only means something if the base payload is one the schema accepts; otherwise
    // every variant below would fail for the wrong reason and the test would pass vacuously.
    expect(clientPublicationPayloadSchema.safeParse(payload).success).toBe(true);

    // Whatever shape a photograph would take — a key, an id, a URL, a list — the allowlist
    // refuses it, because a publication is composed from a closed vocabulary (ADR-027).
    for (const smuggled of [
      { media: [{ url: "https://example.test/p.jpg" }] },
      { photographs: ["t/a/p/b/field-media/c"] },
      { storedObjectId: "44444444-4444-4444-8444-444444444444" },
    ]) {
      expect(
        clientPublicationPayloadSchema.safeParse({ ...payload, ...smuggled }).success,
        JSON.stringify(smuggled),
      ).toBe(false);
    }
  });

  it("an AI provider: the declaration carries no image and no key a caller could fetch", () => {
    const parsed = parseFieldMediaDeclaration(VALID);
    // What leaves for a model is text and a taxonomy. What this type holds is identifiers and a
    // note — no bytes, no data URI, no object key, nothing an adapter could turn into an image.
    const serialised = JSON.stringify(parsed);
    expect(serialised).not.toMatch(/base64|data:|\.jpe?g|\.png|t\/[0-9a-f-]+\/p\//i);
    expect(Object.keys(parsed).sort()).toEqual([
      "assignmentId",
      "capturedAt",
      "kind",
      "localId",
      "location",
      "note",
      "storedObjectId",
      "visitId",
    ]);
  });

  /*
   * The document corpus and public maps are prevented by code that lives in the application layer
   * and the database rather than here:
   *
   * - `uploadDocumentVersion` refuses a stored object whose namespace is `field-media`, and
   *   `declareFieldMedia` refuses one whose namespace is `documents`. Both directions are asserted
   *   in `packages/application/test/field-media.integration.test.ts`.
   * - a map layer comes from a `SpatialDatasetVersion`; `field_media` is not a layer, has no
   *   geometry the GIS read models select, and its only point is the technician's own position.
   *
   * Stated here so the list of four is in one place, and asserted where each one is real.
   */
  it.todo("the document corpus and public maps — asserted in the integration suite");
});
