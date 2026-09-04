import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT, test } from "./fixtures";
import { ensureVersion } from "./reports-runner";

/**
 * Accessibility of the report states: a table whose rows link two ways, and a long structured
 * document rendered as nested lists of figures with their sources.
 *
 * Same caveat as the rest of the axe suite: a scanner catches a minority of accessibility problems.
 */
const BLOCKING = new Set(["serious", "critical"]);
const REPORTS = `/t/${TENANT}/p/${PROJECT}/reports`;

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
  const report = blocking.map((v) => `${v.impact}: ${v.id} — ${v.help}`);
  expect(blocking, `axe violations:\n  ${report.join("\n  ")}`).toEqual([]);
}

test.describe("Reports · accessibility", () => {
  // A version only exists once the chapter has been generated, and this file may execute first.
  test.beforeEach(async ({ page }) => {
    await ensureVersion(page);
  });

  test("the version list", async ({ page }) => {
    await page.goto(REPORTS);
    await expect(page.getByText("Borrador, no entregable").first()).toBeVisible();
    await scan(page);
  });

  test("a version with its figures and sources", async ({ page }) => {
    await page.goto(`${REPORTS}/v1`);
    await expect(page.getByText("Universo y cobertura")).toBeVisible();
    await scan(page);
  });
});
