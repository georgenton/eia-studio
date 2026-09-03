import { expect, PROJECT, TENANT, test } from "./fixtures";
import { ensureProposals } from "./social-worker";

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
  test.beforeEach(async ({ page }) => {
    await ensureProposals(page);
  });

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
    const main = page.getByRole("main");
    // Photographed only when the environment actually has one. A model result is never nudged to
    // produce a picture; if nothing is low confidence there is nothing to show, and the state is
    // covered by the domain tests and by the accessibility scan of this same filter.
    if ((await main.innerText()).includes("revisar primero")) {
      await page.screenshot({ path: `${OUT}/03-low-confidence.png` });
    }
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

  test("a failed classification, with the deterministic half unaffected", async ({ page }) => {
    // Only captured when the environment actually has a failure to show — a provider outage or a
    // misconfigured key. The image is never manufactured: if nothing failed, there is nothing to
    // photograph, and the state is covered by the domain and integration tests instead.
    await page.goto(`${SOCIAL}?tab=abiertas`);
    const failed = page.getByRole("button", { name: "IA fallida" });
    await failed.click();
    const main = page.getByRole("main");
    if ((await main.innerText()).includes("Clasificación fallida")) {
      await page.screenshot({ path: `${OUT}/06-classification-failed.png` });
    }
  });

  test("validated themes beside the provisional distribution", async ({ page }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    await expect(page.getByRole("main")).toContainText("Temas validados");
    await page.screenshot({ path: `${OUT}/05-validated-themes.png`, fullPage: true });
  });
});
