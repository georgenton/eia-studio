import { describe, expect, it } from "vitest";

import {
  assertPublishableEditorial,
  EDITORIAL_SCHEMA_VERSION,
  findEditorialViolations,
  sanitiseEditorialText,
  type EditorialPayload,
} from "../src/index";

/**
 * What a public editorial page may and may not carry.
 *
 * The rules are narrow on purpose (see `EDITORIAL_FORBIDDEN_PATTERNS`): this is prose about an
 * environmental study, so ordinary Spanish stays writable and what is refused is a contact
 * detail, an identity number, a parcel code or this product's own record names. A check that
 * refuses ordinary content is a check people route around, which is why the cases below include
 * as many things that must be *allowed* as things that must not.
 */
const page = (over: Partial<EditorialPayload> = {}): EditorialPayload =>
  ({
    schemaVersion: EDITORIAL_SCHEMA_VERSION,
    locale: "es-EC",
    headline: "Vía de prueba",
    subheadline: null,
    executiveSummary: null,
    sections: [],
    team: [],
    ...over,
  }) as EditorialPayload;

const withPhoto = (storedObjectId: string): EditorialPayload =>
  page({
    sections: [
      {
        key: "foto",
        kind: "custom",
        title: "Fotografía",
        body: "Cobertura vegetal a lo largo del corredor.",
        assets: [
          { storedObjectId, role: "photo", caption: null, altText: "Una vía vista del margen" },
        ],
      },
    ],
  } as Partial<EditorialPayload>);

describe("what a public editorial page may not carry", () => {
  it("refuses a contact detail, an identity number and an internal record name", () => {
    expect(
      findEditorialViolations(page({ headline: "Escríbenos a hola@ejemplo.invalid" })),
    ).toEqual(["email_address"]);
    // Ten digits is a cédula and thirteen is a RUC, as every document this product has seen
    // writes them.
    expect(findEditorialViolations(page({ headline: "Titular 1712345678" }))).toEqual([
      "identity_number",
    ]);
    expect(findEditorialViolations(page({ headline: "según el survey_answer R-0118" }))).toEqual([
      "survey_answer_record",
    ]);
    expect(
      findEditorialViolations(page({ headline: "el predio P-041 y el hallazgo QG-14" })),
    ).toEqual(["parcel_code", "finding_code"]);
  });

  it("allows the ordinary Spanish a consultancy writes", () => {
    for (const headline of [
      // A date, which an earlier version of the identity pattern matched.
      "Levantamiento del 2026-10-06",
      // The words a study is actually about.
      "Acuerdos con propietarios y técnicos del tramo",
      // A chainage, which is surveying notation rather than a number.
      "Desde la abscisa 2+840 hasta 5+360",
      "Longitud total de 5,36 km y 141 predios frentistas",
    ]) {
      expect(findEditorialViolations(page({ headline }))).toEqual([]);
    }
  });
});

/**
 * The scan reads **prose**, not the identifiers this product generated.
 *
 * It used to run over `JSON.stringify(payload)`. A stored object id is a UUID, so about one page
 * in a few hundred carried a run of exactly ten digits inside one and was refused as an
 * `identity_number` — a refusal naming something the author never typed and could not remove.
 */
describe("the scan and machine identifiers", () => {
  const TEN_DIGITS_INSIDE_A_UUID = "0199f3a2-7c41-7abc-8d0f-1234567890ab";

  it("does not read a stored object id as somebody's identity number", () => {
    expect(TEN_DIGITS_INSIDE_A_UUID).toMatch(/(?<!\d)\d{10}(?!\d)/u);
    expect(findEditorialViolations(withPhoto(TEN_DIGITS_INSIDE_A_UUID))).toEqual([]);
    expect(() => assertPublishableEditorial(withPhoto(TEN_DIGITS_INSIDE_A_UUID))).not.toThrow();
  });

  it("still reads everything a visitor would see", () => {
    // The same id, this time typed into the caption, where it is text on the page.
    const payload = page({
      sections: [
        {
          key: "foto",
          kind: "custom",
          title: "Fotografía",
          body: "",
          assets: [
            {
              storedObjectId: TEN_DIGITS_INSIDE_A_UUID,
              role: "photo",
              caption: "Cédula 1712345678",
              altText: "Una vía",
            },
          ],
        },
      ],
    } as Partial<EditorialPayload>);
    expect(findEditorialViolations(payload)).toEqual(["identity_number"]);
  });

  it("does not let two innocent fields form a match across the seam between them", () => {
    // `12345` and `67890` are five digits each. Concatenated they are ten; joined by a newline
    // they are two numbers, which is what they are.
    expect(findEditorialViolations(page({ headline: "12345", subheadline: "67890" }))).toEqual([]);
  });
});

describe("sanitising a line of text", () => {
  it("removes control characters and normalises the separators a paste brings in", () => {
    expect(sanitiseEditorialText("a\u0000b")).toBe("ab");
    expect(sanitiseEditorialText("a b")).toBe("a\nb");
    expect(sanitiseEditorialText("﻿hola")).toBe("hola");
    // A tab and a newline are ordinary text somebody may have typed.
    expect(sanitiseEditorialText("a\tb\nc")).toBe("a\tb\nc");
  });
});
