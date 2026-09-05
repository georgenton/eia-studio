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
