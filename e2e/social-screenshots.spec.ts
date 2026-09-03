import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * Visual baseline for Social Intelligence (Slice 4 §62).
 *
 * These are our own regression references at 1440px, not a pixel comparison against the design
 * bundle: the goldens define hierarchy and interaction, and a screenshot that disagreed with a
 * computed figure would be a reference inconsistency to record, never a number to change
 * (ARCHITECTURE.md §11a).
 *
 * **What is in these images.** Synthetic demonstration responses, a reconstructed taxonomy, and
 * proposals produced by the deterministic *fake* classifier — the suite never calls a live model.
 * Any image showing an AI proposal is therefore a UI state, not evidence about a model's
 * behaviour, and the report says so beside it.
 */
const OUT = "docs/screenshots/slice-4";
const SOCIAL = `/t/${TENANT}/p/${PROJECT}/social`;

test.describe("Slice 4 screenshots", () => {
  test("deterministic tabulation", async ({ page }) => {
    await page.goto(SOCIAL);
    await expect(page.getByRole("main")).toContainText("Tabulación de preguntas cerradas");
    await page.screenshot({ path: `${OUT}/01-tabulation.png`, fullPage: true });
  });

  test("open responses with provisional proposals", async ({ page }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    await expect(page.getByRole("main")).toContainText("Respuestas abiertas");
    await page.screenshot({ path: `${OUT}/02-open-responses.png`, fullPage: true });
  });

  test("a low-confidence proposal, queued for review first", async ({ page }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    await page.getByRole("button", { name: "Confianza baja" }).click();
    await expect(page.getByRole("main")).toContainText("revisar primero");
    await page.screenshot({ path: `${OUT}/03-low-confidence.png` });
  });

  test("the review workspace", async ({ page }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    const review = page.getByRole("button", { name: "Revisar y decidir" }).first();
    if ((await review.count()) > 0) {
      await review.click();
      await expect(page.getByRole("main")).toContainText("Categorías de esta versión");
      await page.screenshot({ path: `${OUT}/04-review.png` });
    }
  });

  test("validated themes beside the provisional distribution", async ({ page }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    await expect(page.getByRole("main")).toContainText("Temas validados");
    await page.screenshot({ path: `${OUT}/05-validated-themes.png`, fullPage: true });
  });
});
