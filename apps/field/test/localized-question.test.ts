import type { PackQuestion } from "@eia/field-sync-contract";
import { describe, expect, it } from "vitest";

import { availableLocales, localizeQuestion } from "../src/core/localized-question";

const question: PackQuestion = {
  code: "tenure_category",
  ordinal: 0,
  type: "SINGLE_CHOICE",
  prompt: "¿Relación con el predio?",
  helpText: "Marca una sola opción.",
  required: true,
  sensitivity: "NON_PERSONAL",
  section: "Vivienda",
  options: [
    { code: "owner_occupier", label: "Propietario ocupante", ordinal: 0 },
    { code: "tenant", label: "Arrendatario", ordinal: 1 },
  ],
  translations: {
    en: {
      prompt: "Relationship to the parcel?",
      helpText: "Choose one option.",
      section: "Housing",
      options: { owner_occupier: "Owner-occupier", tenant: "Tenant" },
    },
  },
};

describe("reading a questionnaire in another language", () => {
  it("changes every word and no identity", () => {
    const spanish = localizeQuestion(question, "es-EC");
    const english = localizeQuestion(question, "en");

    expect(spanish.prompt).toBe("¿Relación con el predio?");
    expect(english.prompt).toBe("Relationship to the parcel?");
    expect(english.options.map((o) => o.label)).toEqual(["Owner-occupier", "Tenant"]);

    // The part that must never move: what an answer points at.
    expect(english.code).toBe(spanish.code);
    expect(english.options.map((o) => o.code)).toEqual(spanish.options.map((o) => o.code));
    expect(english.options.map((o) => o.code)).toEqual(["owner_occupier", "tenant"]);
  });

  it("falls back to the canonical wording rather than to a blank or a key", () => {
    // A version published before the product became bilingual carries no translations at all.
    const monolingual: PackQuestion = { ...question, translations: {} };
    const english = localizeQuestion(monolingual, "en");
    expect(english.prompt).toBe("¿Relación con el predio?");
    expect(english.options[0]!.label).toBe("Propietario ocupante");
  });

  it("falls back per option, so a half-finished translation is still usable", () => {
    const partial: PackQuestion = {
      ...question,
      translations: {
        en: {
          prompt: "Relationship to the parcel?",
          helpText: null,
          section: "Housing",
          options: { tenant: "Tenant" },
        },
      },
    };
    const english = localizeQuestion(partial, "en");
    expect(english.options[0]!.label).toBe("Propietario ocupante");
    expect(english.options[1]!.label).toBe("Tenant");
  });

  it("says which languages the questionnaire can be read in", () => {
    expect(availableLocales([question], "es-EC")).toEqual(["es-EC", "en"]);
    expect(availableLocales([{ ...question, translations: {} }], "es-EC")).toEqual(["es-EC"]);
  });
});
