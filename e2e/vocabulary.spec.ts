import { expect, PARCELS, PROJECT, TENANT, test } from "./fixtures";

/**
 * The product speaks Spanish to an environmental consultant (ADR-025).
 *
 * This suite exists because the leak is systematic rather than occasional: an enum reaches a screen
 * whenever a component renders a domain value directly, and each one looks small on its own. Read
 * together — `DATA PROVENANCE`, `Human validation`, `SYNTHETIC`, `REAL BASE MAP` — they turn a
 * product for consultants into a debugging view of its own database.
 *
 * Two rules, over the text a reader actually sees:
 *
 * 1. **No identifier shapes.** `SCREAMING_SNAKE_CASE` is never Spanish prose; if one appears, some
 *    surface is printing a stored value instead of a label. The document the PGAS renders is full
 *    of capitals but no underscores, so the rule does not fight the source material.
 * 2. **No leaked English.** A denylist of the terms this product actually leaked, so a regression
 *    names itself rather than being spotted by eye.
 *
 * Codes the consultancy uses (`PPMI-01`, `QG-001`, `DOC-002`, `EPSG:32717`) are identifiers a
 * reader *wants*; they carry no underscore and are not in the denylist.
 */
const SURFACES: ReadonlyArray<{ name: string; path: string }> = [
  { name: "Portfolio", path: `/t/${TENANT}` },
  { name: "Command Center", path: `/t/${TENANT}/p/${PROJECT}` },
  { name: "GIS", path: `/t/${TENANT}/p/${PROJECT}/gis` },
  { name: "Parcel Workspace", path: `/t/${TENANT}/p/${PROJECT}/parcels/${PARCELS.a}` },
  { name: "Field Surveys", path: `/t/${TENANT}/p/${PROJECT}/field` },
  { name: "Social Intelligence", path: `/t/${TENANT}/p/${PROJECT}/social` },
  { name: "Quality Gate", path: `/t/${TENANT}/p/${PROJECT}/quality` },
  { name: "Documents", path: `/t/${TENANT}/p/${PROJECT}/documents` },
  { name: "Plan de Manejo", path: `/t/${TENANT}/p/${PROJECT}/pgas` },
  { name: "Reports", path: `/t/${TENANT}/p/${PROJECT}/reports` },
  { name: "Portal del cliente", path: `/t/${TENANT}/p/${PROJECT}/portal` },
  // The client's page is the surface where leaked internal vocabulary would reach somebody outside
  // the firm, so it is the one this rule matters most on.
  { name: "Vista del cliente", path: `/portal/${TENANT}/${PROJECT}` },
  { name: "Social · abiertas", path: `/t/${TENANT}/p/${PROJECT}/social?tab=abiertas` },
  {
    name: "Parcel · visitas",
    path: `/t/${TENANT}/p/${PROJECT}/parcels/${PARCELS.a}?tab=visitas`,
  },
];

/** An identifier shape: two or more capitalised segments joined by underscores. */
const IDENTIFIER_SHAPE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** The English this product leaked, verbatim. Each entry was on a screen before ADR-025. */
const LEAKED_ENGLISH = [
  "DATA PROVENANCE",
  "SOURCE TYPE",
  "Human validation",
  "REAL BASE MAP",
  "RECONSTRUCTED ALIGNMENT",
  "SYNTHETIC PARCELS",
  "OFFICIAL IMPORTED ALIGNMENT",
  "OFFICIAL CADASTRE",
  "FIELD CAPTURED",
  "IMPORTED STUDY LAYER",
  "STUDY DELIMITED AREA",
  "SYNTHETIC",
  "RECONSTRUCTED",
  "ANONYMIZED",
  // Module names. They read as branding to whoever wrote them and as untranslated software to the
  // consultant reading the screen; the keys and the URLs keep them, the copy does not.
  "Command Center",
  "Field Surveys",
  "Social Intelligence",
  "Quality Gate",
  "FieldFlow",
  "Parcel Explorer",
  // The organisation is an organisation; «tenant» is what the schema calls it.
  "Tenant",
  "tenant",
  "Portfolio",
  "Workspace",
  "capabilities",
  // Loading terminology. A consultant reads about the expediente, not about our test data.
  "fixture",
  // Authorization keys and rule keys, which belong in a finding's detail and nowhere else.
  "field.responses.read",
  "rule.",
  // Role and status enums.
  "COORDINATOR",
  "MEMBER",
  "COMPLETED",
  "SUBMITTED",
  "PENDING",
];

/** The rail is outside `main`, and it was the most visible English in the product. */
test("the rail names every module in Spanish", async ({ page }) => {
  await page.goto(`/t/${TENANT}/p/${PROJECT}`);
  const rail = page.getByRole("navigation").first();
  const text = await rail.innerText();
  for (const term of [
    "Command Center",
    "Field Surveys",
    "Social Intelligence",
    "Quality Gate",
    "Documents",
    "Reports",
  ]) {
    expect(text, `the rail still says «${term}»`).not.toContain(term);
  }
  await expect(rail).toContainText("Centro de control");
  await expect(rail).toContainText("Control de consistencia");
});

/** The drawer is a dialog, so `main` never sees it — and it held three of the leaks. */
test("the provenance drawer speaks Spanish", async ({ page }) => {
  await page.goto(`/t/${TENANT}/p/${PROJECT}`);
  await page.getByRole("link", { name: "Ver origen" }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  const text = await drawer.innerText();

  expect(
    [...new Set(text.match(IDENTIFIER_SHAPE) ?? [])],
    "the drawer renders identifiers",
  ).toEqual([]);
  expect(
    LEAKED_ENGLISH.filter((term) => text.includes(term)),
    "the drawer renders leaked English",
  ).toEqual([]);
  await expect(drawer).toContainText("ORIGEN DEL DATO");
  await expect(drawer).toContainText("Validación humana");
});

for (const surface of SURFACES) {
  test(`${surface.name} speaks Spanish, with no identifier left on screen`, async ({ page }) => {
    const response = await page.goto(surface.path);
    expect(response?.status(), `${surface.name} should render`).toBeLessThan(400);
    const text = (await page.getByRole("main").innerText()) ?? "";

    const identifiers = [...new Set(text.match(IDENTIFIER_SHAPE) ?? [])];
    expect(identifiers, `${surface.name} renders stored identifiers`).toEqual([]);

    const english = LEAKED_ENGLISH.filter((term) => text.includes(term));
    expect(english, `${surface.name} renders leaked English`).toEqual([]);
  });
}

/* ---------------------------------------------------------------------------------------------
 * The same surfaces, in English (ADR-029)
 * ------------------------------------------------------------------------------------------ */

/**
 * A bilingual product that only ever gets checked in one language has one language and a menu.
 *
 * The rule is the mirror of the one above: with the locale cookie set to `en`, no surface may show
 * Spanish interface copy, and none may show an identifier either. What it deliberately does *not*
 * forbid is Spanish **content** — the project's name, a parcel's sector, a document's title, the
 * management plan's measures, and the client publication, which is rendered in the language it was
 * published in. Those are the study's own words and translating them would be inventing a document
 * nobody wrote.
 */
const LEAKED_SPANISH = [
  // The rail, in the words the Spanish product uses.
  "Centro de control",
  "Cartografía y predios",
  "Trabajo de campo",
  "Análisis social",
  "Control de consistencia",
  "Documentos",
  "Informes",
  "Portal del cliente",
  // The four SOURCE TYPE badges and the drawer's own fields.
  "Dato histórico",
  "Dato calculado",
  "Agregado sin datos personales",
  "Simulación operativa",
  "ORIGEN DEL DATO",
  "Validación humana",
  // Copy that used to be a domain constant, which is where a regression would come from.
  "Confirmado",
  "En verificación",
  "Predios simulados",
  "Coincidencia IA",
  "Confianza del modelo",
  "Borrador, no entregable",
];

/** Surfaces whose content is the study's own; the interface around it is still checked. */
const ENGLISH_SURFACES = SURFACES.filter(
  (surface) => surface.name !== "Vista del cliente" && surface.name !== "Plan de Manejo",
);

for (const surface of ENGLISH_SURFACES) {
  test(`${surface.name} speaks English when the reader chose English`, async ({ page }) => {
    // The choice is a cookie, so it is set on the origin the app is served from and the surface
    // then renders in English on the *server* — there is no flash and nothing to hydrate.
    await page.goto(surface.path);
    await page.context().addCookies([{ name: "eia.locale", value: "en", url: page.url() }]);
    const response = await page.reload();
    expect(response?.status(), `${surface.name} should render`).toBeLessThan(400);
    const text = (await page.getByRole("main").innerText()) ?? "";

    expect(
      [...new Set(text.match(IDENTIFIER_SHAPE) ?? [])],
      `${surface.name} renders stored identifiers in English`,
    ).toEqual([]);
    expect(
      LEAKED_SPANISH.filter((term) => text.includes(term)),
      `${surface.name} still renders Spanish interface copy`,
    ).toEqual([]);
  });
}

test("the rail, the drawer and the switcher all follow the reader", async ({ page }) => {
  await page.goto(`/t/${TENANT}/p/${PROJECT}`);
  const rail = page.getByRole("navigation").first();
  await expect(rail).toContainText("Centro de control");

  // The switcher is inside the account menu, named in its own language on purpose.
  await page.getByRole("group", { name: /Cuenta de/ }).click();
  await page.getByRole("button", { name: "English" }).click();
  await expect(rail).toContainText("Command Centre");
  await expect(rail).not.toContainText("Centro de control");

  // And the choice survives a navigation, because it is a cookie rather than page state.
  await page.goto(`/t/${TENANT}/p/${PROJECT}/quality`);
  await expect(page.getByRole("navigation").first()).toContainText("Consistency control");
  await expect(page.getByRole("main")).toContainText("Consistency control");
});
