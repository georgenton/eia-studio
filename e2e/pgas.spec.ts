import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * The management plan, as a coordinator reads it (ADR-024).
 *
 * Three properties, and all three are about honesty rather than features.
 *
 * The surface shows the plan the study **proposes** — so nothing on it may offer to record that a
 * measure was carried out. The road has not been built; a tick box would be a claim about the world
 * that nobody made.
 *
 * The identifiers are labelled by owner: the document's own `N°` beside the code this product
 * minted, because a reader must not quote `PPMI-01.01.01` back to the consultancy as if it were
 * theirs.
 *
 * And the document's inconsistencies survive being read: a plan with no code and a column spelled
 * two ways are reported as observations, in the chapter's own words, not silently repaired.
 */
const PGAS = `/t/${TENANT}/p/${PROJECT}/pgas`;

test.describe("Plan de Manejo · the coordinator's journey", () => {
  test("the chapter is there, with its plans and its measures counted", async ({ page }) => {
    await page.goto(PGAS);
    const main = page.getByRole("main");
    await expect(main.getByText("Plan de Manejo Ambiental y Social").first()).toBeVisible();
    await expect(main.getByText(/\d+ planes · \d+ medidas/).first()).toBeVisible();
    await expect(main).toContainText("PLAN DE PREVENCIÓN Y MITIGACIÓN DE IMPACTOS");
  });

  test("says the plan is proposed, and never that it is being complied with", async ({ page }) => {
    await page.goto(PGAS);
    const main = page.getByRole("main");
    const summary = main.locator("section").first();
    await expect(summary).toContainText("propone");
    await expect(summary).toContainText("no registra aquí su ejecución ni su cumplimiento");
    /*
     * Invariant 11's vocabulary, asserted over what **this product** writes — the summary panel
     * and the footnote — and not over the chapter's own sentences, which are the consultancy's
     * words and are quoted whatever they say. A measure that mentions «incumplimiento» is the
     * study speaking; a heading that did would be us.
     */
    const FORBIDDEN = /incumplimiento|no conforme|infracci[óo]n|error detectado/i;
    await expect(summary).not.toContainText(FORBIDDEN);
    await expect(main.getByText(/El «N° del documento»/)).not.toContainText(FORBIDDEN);
    // Nothing here offers to record that a measure was carried out (ADR-024 §7).
    await expect(main.getByRole("checkbox")).toHaveCount(0);
    await expect(main.getByRole("button", { name: /cumpl|evidencia|verificar/i })).toHaveCount(0);
  });

  test("distinguishes the document's numbering from the code this product minted", async ({
    page,
  }) => {
    await page.goto(PGAS);
    const main = page.getByRole("main");
    // Both identifiers on every measure: the document's own number and the code minted here.
    await expect(main.getByText(/N° del documento:/).first()).toBeVisible();
    await expect(main.getByText(/Código EIA Studio:/).first()).toBeVisible();
    await expect(main).toContainText("no es una referencia de la consultora");
    // The minted shape: plan code · programme · row, beside the label that says whose it is.
    await expect(
      main.getByText(/Código EIA Studio: [A-Z-]+\d*\.\d{2}\.\d{2}/).first(),
    ).toBeVisible();
  });

  test("reports what the chapter leaves inconsistent, in the chapter's own words", async ({
    page,
  }) => {
    await page.goto(PGAS);
    const main = page.getByRole("main");
    // One of the nine plans carries no code, and the surface names it rather than inventing one.
    await expect(main).toContainText("no trae código");
    await expect(main).toContainText("PLAN DE SEGURIDAD INDUSTRIAL Y SALUD OCUPACIONAL");
    // The delivered chapter spells one column `FRENCUENCIA` in eight plans and `FRECUENCIA` in one.
    await expect(main).toContainText("de más de una forma");
    await expect(main).toContainText("FRENCUENCIA");
    await expect(main).toContainText("Se conservan tal como aparecen en el documento");
  });

  test("the import carries provenance a reader can open", async ({ page }) => {
    await page.goto(PGAS);
    await page.getByRole("main").getByRole("link", { name: "Ver origen del dato" }).first().click();
    await expect(page).toHaveURL(/\?prov=/);
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Régimen");
  });
});
