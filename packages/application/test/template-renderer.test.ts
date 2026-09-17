import {
  DRAFT_BANNERS,
  InvalidInput,
  TemplateDataMissing,
  UnsupportedUpload,
  type TemplateBinding,
} from "@eia/domain";
import {
  buildDocxTemplate,
  buildMacroEnabledTemplate,
  buildNotAWordPackage,
  buildZipBomb,
} from "@eia/testing/documents";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  assertTemplateArchiveSafe,
  readTemplateManifest,
  renderTemplate,
} from "../src/templates/renderer";

/**
 * The renderer, against real Word packages (ADR-036).
 *
 * The suite is about the four things a template must not be able to do: carry code, reach data
 * nobody declared, print a figure the project does not have, or produce a document that does not
 * say it is a draft.
 */
const NOT_AVAILABLE = "Dato no disponible";

const binding = (values: Record<string, string | null>, locale = "es-EC"): TemplateBinding => ({
  locale,
  values: Object.entries(values).map(([key, text]) => ({ key, text })),
});

/** Everything a well-formed template needs plus whatever the test adds. */
const base = {
  "project.name": "Vía de prueba",
  "generation.date": "17 sept 2026",
  "generation.locale": "es-EC",
  "generation.draft_banner": DRAFT_BANNERS["es-EC"],
};

async function textOf(bytes: Uint8Array): Promise<string> {
  const files = unzipSync(bytes, { filter: (file) => file.name === "word/document.xml" });
  return new TextDecoder()
    .decode(files["word/document.xml"]!)
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)));
}

describe("what the archive must be before it is a template", () => {
  it("accepts a Word package", () => {
    expect(() => assertTemplateArchiveSafe(buildDocxTemplate([{ runs: ["Hola"] }]))).not.toThrow();
  });

  /*
   * A `.docm` renamed `.docx` presents the same `PK\x03\x04` signature and the same declared MIME
   * type as a legitimate template, so the extension gate cannot see it. The macro project's
   * presence is what makes a package macro-enabled, whatever the file is called.
   */
  it("refuses a package carrying a macro project", () => {
    expect(() =>
      assertTemplateArchiveSafe(buildMacroEnabledTemplate([{ runs: ["Hola"] }])),
    ).toThrow(UnsupportedUpload);
  });

  it("refuses a container that is not a Word document", () => {
    expect(() => assertTemplateArchiveSafe(buildNotAWordPackage())).toThrow(UnsupportedUpload);
  });

  it("refuses an archive that expands far beyond its size", () => {
    expect(() => assertTemplateArchiveSafe(buildZipBomb())).toThrow(UnsupportedUpload);
  });

  it("refuses an empty file and a file that is not an archive at all", () => {
    expect(() => assertTemplateArchiveSafe(new Uint8Array())).toThrow(UnsupportedUpload);
    expect(() => assertTemplateArchiveSafe(new TextEncoder().encode("not a zip"))).toThrow(
      UnsupportedUpload,
    );
  });
});

describe("the manifest, which is what activation is decided on", () => {
  /*
   * The case a regular expression cannot handle, and the reason a parser is here: Word splits a
   * run whenever anything about the text changes, so a placeholder normally lives in several
   * `<w:r>` elements.
   */
  it("reassembles a placeholder split across runs", async () => {
    const manifest = await readTemplateManifest(
      buildDocxTemplate([
        { runs: ["Proyecto: ", "{{", "pro", "ject.na", "me}}"] },
        { runs: ["{{generation.draft_banner}}"] },
      ]),
    );
    expect(manifest.supported).toContain("project.name");
    expect(manifest.unknown).toEqual([]);
  });

  it("reports a placeholder nobody declared rather than ignoring it", async () => {
    const manifest = await readTemplateManifest(
      buildDocxTemplate([
        { runs: ["{{project.name}} {{respondent.full_name}} {{project.budget}}"] },
        { runs: ["{{generation.draft_banner}}"] },
      ]),
    );
    expect(manifest.supported).toEqual(["project.name", "generation.draft_banner"]);
    expect(manifest.unknown).toEqual(["respondent.full_name", "project.budget"]);
  });

  /*
   * The plugin-prefixed forms. The plugins are removed from the handler as well, so this is the
   * second of two independent refusals — but it is the one that tells a person *why*.
   */
  it("treats a raw-XML, image or link tag as a placeholder nobody declared", async () => {
    const manifest = await readTemplateManifest(
      buildDocxTemplate([
        { runs: ["{{@rawXml}} {{%image}} {{*link}}"] },
        { runs: ["{{generation.draft_banner}}"] },
      ]),
    );
    expect(manifest.unknown).toEqual(["@rawXml", "%image", "*link"]);
    expect(manifest.supported).toEqual(["generation.draft_banner"]);
  });

  it("names the required placeholders separately from the optional ones", async () => {
    const manifest = await readTemplateManifest(
      buildDocxTemplate([
        { runs: ["{{project.name}} · {{territory.corridor_length_km}} km"] },
        { runs: ["{{generation.draft_banner}}"] },
      ]),
    );
    expect(manifest.required).toEqual(["project.name", "generation.draft_banner"]);
    expect(manifest.supported).toContain("territory.corridor_length_km");
  });
});

describe("rendering", () => {
  it("substitutes a split placeholder and leaves the document a Word package", async () => {
    const rendered = await renderTemplate({
      bytes: buildDocxTemplate([
        { runs: ["Proyecto: ", "{{", "project", ".name}}"] },
        { runs: ["Fecha: {{generation.date}} · {{generation.locale}}"] },
        { runs: ["{{generation.draft_banner}}"] },
      ]),
      binding: binding(base),
      notAvailableText: NOT_AVAILABLE,
    });

    const text = await textOf(rendered.bytes);
    expect(text).toContain("Proyecto: Vía de prueba");
    expect(text).toContain("Fecha: 17 sept 2026");
    expect(text).not.toContain("{{");
    // Still a Word package: the parts survive, which a string-substituting renderer would not
    // guarantee.
    const parts = Object.keys(unzipSync(rendered.bytes));
    expect(parts).toContain("word/document.xml");
    expect(parts).toContain("[Content_Types].xml");
  });

  /*
   * The rule that keeps a template from inventing a measurement. A corridor nobody has measured is
   * not zero kilometres long, and a renderer that printed `0` would have made a claim.
   */
  it("prints an explicit no-value for an absent optional placeholder, never zero", async () => {
    const rendered = await renderTemplate({
      bytes: buildDocxTemplate([
        { runs: ["Longitud: {{territory.corridor_length_km}} km"] },
        { runs: ["Predios: {{territory.parcel_universe}}"] },
        { runs: ["{{project.name}} {{generation.date}} {{generation.locale}}"] },
        { runs: ["{{generation.draft_banner}}"] },
      ]),
      binding: binding({
        ...base,
        "territory.corridor_length_km": null,
        "territory.parcel_universe": null,
      }),
      notAvailableText: NOT_AVAILABLE,
    });

    const text = await textOf(rendered.bytes);
    expect(text).toContain(`Longitud: ${NOT_AVAILABLE} km`);
    expect(text).toContain(`Predios: ${NOT_AVAILABLE}`);
    expect(text).not.toMatch(/Longitud: 0 km/);
    expect(text).not.toMatch(/Predios: 0/);
    // Recorded, so a reader of the archive can tell a blank the project had from one a later
    // change created.
    expect([...rendered.declaredAbsent].sort()).toEqual([
      "territory.corridor_length_km",
      "territory.parcel_universe",
    ]);
  });

  it("refuses to generate when a required placeholder has no value", async () => {
    await expect(
      renderTemplate({
        bytes: buildDocxTemplate([
          { runs: ["Proyecto: {{project.name}}"] },
          { runs: ["{{generation.date}} {{generation.locale}} {{generation.draft_banner}}"] },
        ]),
        binding: binding({ ...base, "project.name": null }),
        notAvailableText: NOT_AVAILABLE,
      }),
    ).rejects.toThrow(TemplateDataMissing);
  });

  it("refuses a template that uses a placeholder nobody declared", async () => {
    await expect(
      renderTemplate({
        bytes: buildDocxTemplate([
          { runs: ["{{project.name}} {{respondent.phone}}"] },
          { runs: ["{{generation.date}} {{generation.locale}} {{generation.draft_banner}}"] },
        ]),
        binding: binding(base),
        notAvailableText: NOT_AVAILABLE,
      }),
    ).rejects.toThrow(InvalidInput);
  });

  /*
   * The check that looks redundant beside activation's, and is not: activation requires the
   * placeholder to be *in* the template, and this requires it to have *rendered*. Between them
   * there is no arrangement in which a document leaves without saying what it is.
   */
  it("refuses a rendered document that does not carry the draft banner", async () => {
    await expect(
      renderTemplate({
        bytes: buildDocxTemplate([
          { runs: ["Proyecto: {{project.name}}"] },
          { runs: ["{{generation.date}} · {{generation.locale}}"] },
        ]),
        binding: binding(base),
        notAvailableText: NOT_AVAILABLE,
      }),
    ).rejects.toThrow(/draft banner/);
  });

  it("carries the banner in the language the document was rendered in", async () => {
    const rendered = await renderTemplate({
      bytes: buildDocxTemplate([
        { runs: ["Project: {{project.name}} {{generation.date}} {{generation.locale}}"] },
        { runs: ["{{generation.draft_banner}}"] },
      ]),
      binding: binding(
        { ...base, "generation.locale": "en", "generation.draft_banner": DRAFT_BANNERS.en },
        "en",
      ),
      notAvailableText: "Not available",
    });
    expect(await textOf(rendered.bytes)).toContain("DRAFT — NOT AN APPROVED DELIVERABLE");
  });

  /*
   * The decisive property of the closed resolver. The library's default is `lodash.get` over the
   * data object, so a tag would be a path into whatever we handed it; here a tag is a registry key
   * or it is nothing, and the data object passed to the library is empty.
   */
  it("gives a template no way to read anything outside the registry", async () => {
    const rendered = await renderTemplate({
      bytes: buildDocxTemplate([
        { runs: ["{{project.name}} {{generation.date}} {{generation.locale}}"] },
        { runs: ["{{generation.draft_banner}}"] },
      ]),
      binding: {
        locale: "es-EC",
        values: [
          ...Object.entries(base).map(([key, text]) => ({ key, text })),
          // A value that is not a registry key cannot be reached even when it is in the binding.
          { key: "secret.token", text: "no-debe-aparecer" },
        ],
      },
      notAvailableText: NOT_AVAILABLE,
    });
    expect(await textOf(rendered.bytes)).not.toContain("no-debe-aparecer");
  });

  it("repeats a container over a list without letting it reach anything else", async () => {
    // `pgas.measures` is a count in the registry, so a template using it as a container gets the
    // count and no iteration — repetition over rows is a later decision, and the registry is what
    // says so rather than the template.
    const manifest = await readTemplateManifest(
      buildDocxTemplate([
        { runs: ["{{#pgas.measures}}"] },
        { runs: ["{{code}}"] },
        { runs: ["{{/pgas.measures}}"] },
        { runs: ["{{generation.draft_banner}}"] },
      ]),
    );
    expect(manifest.containers).toEqual(["pgas.measures"]);
    // `code` is not a declared placeholder, so this template cannot be activated.
    expect(manifest.unknown).toEqual(["code"]);
  });
});
