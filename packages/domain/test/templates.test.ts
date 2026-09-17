import {
  assertActivatable,
  assertNoMacroProject,
  assertTemplateTransition,
  assertWordPackage,
  bindingShortfall,
  buildManifest,
  DRAFT_BANNERS,
  DRAFT_BANNER_PLACEHOLDER,
  draftBannerFor,
  InvalidInput,
  MAX_TEMPLATE_TAGS,
  PLACEHOLDERS,
  PLACEHOLDER_KEYS,
  placeholderFor,
  TEMPLATE_DELIMITERS,
  TEMPLATE_LOCALES,
  TemplateMissingDraftBanner,
  TemplateNotActivatable,
  UnsupportedUpload,
  type TemplateBinding,
  type TemplateTag,
} from "../src/index";
import { describe, expect, it } from "vitest";

/**
 * What a consultancy's template is not allowed to make this product say (ADR-036).
 */
const tag = (name: string, disposition = "SelfClosed"): TemplateTag => ({ name, disposition });

describe("the closed placeholder vocabulary", () => {
  it("declares a source and an absence behaviour for every key", () => {
    expect(PLACEHOLDERS.length).toBeGreaterThan(0);
    for (const definition of PLACEHOLDERS) {
      expect(definition.source.length).toBeGreaterThan(10);
      expect(["BLOCKS", "DECLARED"]).toContain(definition.absence);
    }
    expect(new Set(PLACEHOLDER_KEYS).size).toBe(PLACEHOLDER_KEYS.length);
  });

  /*
   * The enumeration is the control. A template can only print what is in this list, so what is
   * *absent* from it is checkable rather than merely intended — and these are the things a
   * deliverable must never carry because a template asked for them.
   */
  it("contains nothing personal, nothing provisional and nothing internal", () => {
    const forbidden = [
      "respondent",
      "answer",
      "phone",
      "income",
      "household",
      "pii",
      "candidate",
      "classification",
      "ai.",
      "finding",
      "storage",
      "object_key",
      "uuid",
      "token",
    ];
    for (const key of PLACEHOLDER_KEYS) {
      for (const word of forbidden) {
        expect(key.toLowerCase(), `${key} must not name ${word}`).not.toContain(word);
      }
    }
  });

  it("names every source as deterministic or declared, never a model", () => {
    for (const definition of PLACEHOLDERS) {
      expect(definition.source.toLowerCase()).not.toContain("model");
      expect(definition.source.toLowerCase()).not.toContain("ia ");
    }
  });

  it("answers for a key nobody declared without inventing one", () => {
    expect(placeholderFor("respondent.full_name")).toBeNull();
    expect(placeholderFor("project.name")).not.toBeNull();
  });

  it("fixes the delimiters here rather than reading them from a file", () => {
    expect(TEMPLATE_DELIMITERS).toEqual({ tagStart: "{{", tagEnd: "}}" });
  });
});

describe("the manifest", () => {
  it("separates supported, unknown, required and container tags", () => {
    const manifest = buildManifest([
      tag("project.name"),
      tag("territory.corridor_length_km"),
      tag("respondent.phone"),
      tag("pgas.measures", "Open"),
      tag("pgas.measures", "Close"),
      tag("project.name"),
    ]);
    expect(manifest.supported).toEqual([
      "project.name",
      "territory.corridor_length_km",
      "pgas.measures",
    ]);
    expect(manifest.unknown).toEqual(["respondent.phone"]);
    expect(manifest.required).toEqual(["project.name"]);
    expect(manifest.containers).toEqual(["pgas.measures"]);
    expect(manifest.tagCount).toBe(6);
  });

  it("refuses a file carrying more tags than a document holds", () => {
    const many = Array.from({ length: MAX_TEMPLATE_TAGS + 1 }, () => tag("project.name"));
    expect(() => buildManifest(many)).toThrow(InvalidInput);
  });
});

describe("activation, which is a decision rather than a fact", () => {
  const ok = () => [tag("project.name"), tag(DRAFT_BANNER_PLACEHOLDER)];

  it("accepts a template whose every tag is declared and that carries the banner", () => {
    expect(() => assertActivatable(buildManifest(ok()))).not.toThrow();
  });

  /*
   * The refusal the whole validation step exists for. A tag nobody declared renders *empty* if it
   * reaches the renderer — which is how a deliverable goes out with a hole where its author
   * expected a figure. So it is told to a person instead.
   */
  it("refuses an unknown placeholder, naming it and the declared vocabulary", () => {
    let thrown: TemplateNotActivatable | null = null;
    try {
      assertActivatable(buildManifest([...ok(), tag("project.budget_usd")]));
    } catch (error) {
      thrown = error as TemplateNotActivatable;
    }
    expect(thrown).toBeInstanceOf(TemplateNotActivatable);
    expect(thrown!.unknown).toEqual(["project.budget_usd"]);
    expect(thrown!.message).toContain("project.budget_usd");
    expect(thrown!.message).toContain("project.name");
  });

  it("refuses a template that does not say it produces a draft", () => {
    expect(() => assertActivatable(buildManifest([tag("project.name")]))).toThrow(
      TemplateMissingDraftBanner,
    );
  });

  it("refuses a document with no placeholders at all, which is not a template", () => {
    expect(() => assertActivatable(buildManifest([]))).toThrow(InvalidInput);
  });

  it("has a lifecycle where an activated version can only be superseded", () => {
    expect(() => assertTemplateTransition("UPLOADED", "VALIDATED")).not.toThrow();
    expect(() => assertTemplateTransition("VALIDATED", "ACTIVE")).not.toThrow();
    expect(() => assertTemplateTransition("ACTIVE", "SUPERSEDED")).not.toThrow();
    // A corrected template is the next version; an activated one never goes back.
    expect(() => assertTemplateTransition("ACTIVE", "VALIDATED")).toThrow(InvalidInput);
    expect(() => assertTemplateTransition("SUPERSEDED", "ACTIVE")).toThrow(InvalidInput);
    expect(() => assertTemplateTransition("UPLOADED", "ACTIVE")).toThrow(InvalidInput);
  });
});

describe("missing data, which a template must never turn into meaning", () => {
  const binding = (values: Record<string, string | null>): TemplateBinding => ({
    locale: "es-EC",
    values: Object.entries(values).map(([key, text]) => ({ key, text })),
  });

  it("blocks when a placeholder a document cannot be honest without has no value", () => {
    const shortfall = bindingShortfall(
      ["project.name", "generation.date"],
      binding({ "project.name": null, "generation.date": "17 sept 2026" }),
    );
    expect(shortfall.blocking).toEqual(["project.name"]);
    expect(shortfall.declaredAbsent).toEqual([]);
  });

  /*
   * The distinction the whole design rests on: *nobody measured the corridor* and *the corridor is
   * zero kilometres long* are different statements, and only one of them is true.
   */
  it("declares an optional absence rather than printing a number", () => {
    const shortfall = bindingShortfall(
      ["territory.corridor_length_km", "pgas.measures"],
      binding({ "territory.corridor_length_km": null, "pgas.measures": null }),
    );
    expect(shortfall.blocking).toEqual([]);
    expect(shortfall.declaredAbsent).toEqual(["territory.corridor_length_km", "pgas.measures"]);
  });

  it("treats a key the registry does not know as blocking, whatever the binding says", () => {
    const shortfall = bindingShortfall(["invented.key"], binding({ "invented.key": "algo" }));
    expect(shortfall.blocking).toEqual(["invented.key"]);
  });
});

describe("the banner every generated document carries", () => {
  it("is this product's words, in both languages, and never the template's", () => {
    expect(draftBannerFor("es-EC")).toBe("BORRADOR — NO ES UN ENTREGABLE APROBADO");
    expect(draftBannerFor("en")).toBe("DRAFT — NOT AN APPROVED DELIVERABLE");
    expect(Object.keys(DRAFT_BANNERS).sort()).toEqual([...TEMPLATE_LOCALES].sort());
  });
});

describe("what an archive must be before it is read as a template", () => {
  it("refuses a package carrying a macro project, however it is named", () => {
    expect(() =>
      assertNoMacroProject({
        entryNames: ["word/document.xml", "word/vbaProject.bin"],
        contentTypesXml: "<Types/>",
      }),
    ).toThrow(UnsupportedUpload);
    // Case is not a defence: Word writes `vbaProject.bin`, a repacker may not.
    expect(() =>
      assertNoMacroProject({
        entryNames: ["word/VBAPROJECT.BIN"],
        contentTypesXml: "<Types/>",
      }),
    ).toThrow(UnsupportedUpload);
  });

  it("refuses a package that declares itself macro-enabled", () => {
    expect(() =>
      assertNoMacroProject({
        entryNames: ["word/document.xml"],
        contentTypesXml:
          '<Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
      }),
    ).toThrow(UnsupportedUpload);
  });

  /*
   * `PK\x03\x04` is every ZIP there is, so the magic bytes prove only that it is a container.
   */
  it("refuses a container with no Word main part", () => {
    expect(() => assertWordPackage(["readme.txt", "data/rows.csv"])).toThrow(UnsupportedUpload);
    expect(() => assertWordPackage(["word/document.xml"])).not.toThrow();
  });
});
