import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { CLIENT_VIEW, ensurePublication, PORTAL } from "./portal-runner";

/**
 * Accessibility of the two portal surfaces.
 *
 * The client's page matters more than most: its reader is not a trained user of this product, may
 * be reading it on a phone in a council session, and has no colleague to ask. Same caveat as the
 * rest of the axe suite — a scanner catches a minority of accessibility problems.
 */
const BLOCKING = new Set(["serious", "critical"]);

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
  const report = blocking.map((v) => `${v.impact}: ${v.id} — ${v.help}`);
  expect(blocking, `axe violations:\n  ${report.join("\n  ")}`).toEqual([]);
}

test.describe("Portal · accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await ensurePublication(page);
  });

  test("the publication management surface", async ({ page }) => {
    await page.goto(PORTAL);
    await expect(page.getByText("Preparar actualización")).toBeVisible();
    await scan(page);
  });

  test("the client's page", async ({ page }) => {
    await page.goto(CLIENT_VIEW);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("[data-map-idle='true']")).toBeVisible({ timeout: 20_000 });
    await scan(page);
  });

  test("the client's page on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CLIENT_VIEW);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await scan(page);
  });
});
