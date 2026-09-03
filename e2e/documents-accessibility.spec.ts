import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * Accessibility of the document states: a table, a long-form passage list, and a search form whose
 * results appear without a navigation — the pattern most likely to leave a screen reader behind.
 *
 * Same caveat as the rest of the axe suite: a scanner catches a minority of accessibility problems.
 * A green run is a regression net, not a conformance claim.
 */
const BLOCKING = new Set(["serious", "critical"]);
const DOCUMENTS = `/t/${TENANT}/p/${PROJECT}/documents`;

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
  const report = blocking.map(
    (v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node(s))`,
  );
  expect(blocking, `axe violations:\n  ${report.join("\n  ")}`).toEqual([]);
}

test.describe("Documents · accessibility", () => {
  test("the corpus list and the assistant form", async ({ page }) => {
    await page.goto(DOCUMENTS);
    await expect(page.getByLabel("Pregunta al expediente")).toBeVisible();
    await scan(page);
  });

  test("an answer with citations", async ({ page }) => {
    await page.goto(DOCUMENTS);
    await page.getByLabel("Pregunta al expediente").fill("predios con afectación");
    await page.getByRole("button", { name: "Consultar" }).click();
    await expect(page.getByTestId("assistant-answer")).toBeVisible({ timeout: 20_000 });
    await scan(page);
  });

  test("a document's passages", async ({ page }) => {
    await page.goto(`${DOCUMENTS}/DOC-002`);
    await expect(page.getByText("Pasaje 1")).toBeVisible();
    await scan(page);
  });
});
