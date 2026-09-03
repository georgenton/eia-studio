import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * The document evidence layer, as a coordinator sees it.
 *
 * The property under test throughout is that **the citations are the answer**. There is no model
 * configured in CI (and none anywhere, TD-049), so the assistant returns cited passages and says
 * why there is no paragraph — which is the useful half and the honest one.
 */
const DOCUMENTS = `/t/${TENANT}/p/${PROJECT}/documents`;

test.describe("Documents · the coordinator's journey", () => {
  test("the corpus is listed, and says what kind of text it is", async ({ page }) => {
    await page.goto(DOCUMENTS);
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "DOC-001" })).toBeVisible();
    // Every version is a hand transcription, and the surface says so rather than implying an import.
    await expect(main.getByText("Extracto reconstruido del expediente").first()).toBeVisible();
  });

  test("a document shows its passages, which are what a citation names", async ({ page }) => {
    await page.goto(DOCUMENTS);
    await page.getByRole("link", { name: "DOC-002" }).click();
    const main = page.getByRole("main");
    await expect(main).toContainText("Pasaje 1");
    await expect(main).toContainText("paragraph-merge@1");
    await expect(main).toContainText("no cambian mientras exista esta versión");
  });

  test("a question is answered with cited passages from this project", async ({ page }) => {
    await page.goto(DOCUMENTS);
    await page.getByLabel("Pregunta al expediente").fill("predios con afectación");
    await page.getByRole("button", { name: "Consultar" }).click();

    const answer = page.getByTestId("assistant-answer");
    await expect(answer).toBeVisible({ timeout: 20_000 });
    // A citation names the document *and its version*: a citation that named only the document
    // would start pointing at different words the next time a corrected file arrived.
    await expect(answer.getByText(/DOC-\d+ v\d/).first()).toBeVisible();
    await expect(answer).toContainText("Búsqueda léxica");
    await expect(answer).toContainText("no por su significado");
  });

  test("no evidence is said plainly, and cites nothing", async ({ page }) => {
    await page.goto(DOCUMENTS);
    await page.getByLabel("Pregunta al expediente").fill("batimetría oceánica antártica");
    await page.getByRole("button", { name: "Consultar" }).click();

    const answer = page.getByTestId("assistant-answer");
    await expect(answer).toContainText("No se encontraron pasajes", { timeout: 20_000 });
    await expect(answer.getByText(/DOC-\d+ v\d/)).toHaveCount(0);
  });

  test("with no generator configured the passages stand alone, and the reason is stated", async ({
    page,
  }) => {
    await page.goto(DOCUMENTS);
    await page.getByLabel("Pregunta al expediente").fill("consulta");
    await page.getByRole("button", { name: "Consultar" }).click();

    const answer = page.getByTestId("assistant-answer");
    await expect(answer).toBeVisible({ timeout: 20_000 });
    await expect(answer.locator('[data-system-state="ai-unavailable"]')).toContainText(
      /no está configurada|configuración externa|determinista de pruebas/,
    );
    await expect(answer.getByText(/DOC-\d+ v\d/).first()).toBeVisible();
  });

  test("a document code that means nothing answers 404", async ({ page }) => {
    const missing = await page.goto(`${DOCUMENTS}/DOC-999`);
    expect(missing?.status()).toBe(404);
  });
});
