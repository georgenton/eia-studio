import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * Accessibility smoke suite (IG1-005). Four representative states, checked with axe against the
 * WCAG 2.1 A/AA rule sets, failing on `serious` and `critical` violations.
 *
 * What this does **not** claim: axe finds a minority of accessibility problems, so a green run is
 * not evidence of WCAG conformance. It is a regression net for the mistakes a scanner does catch
 * — missing labels and names, contrast, landmark and heading structure, ARIA misuse — and it sits
 * alongside the manual keyboard and focus assertions in `journey.spec.ts`, which it replaces
 * nothing of.
 */
const BLOCKING = new Set(["serious", "critical"]);

async function scan(page: Page, context?: string) {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  const results = await (context ? builder.include(context) : builder).analyze();
  const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
  const report = blocking.map(
    (v) =>
      `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node(s))\n    ${v.nodes[0]?.target.join(" ")}`,
  );
  expect(blocking, `axe violations:\n  ${report.join("\n  ")}`).toEqual([]);
  return results;
}

test.describe("accessibility smoke", () => {
  test("sign in", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/sign-in");
    await scan(page);
  });

  test("portfolio", async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await page.waitForLoadState("networkidle");
    await scan(page);
  });

  test("command center", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    await page.waitForLoadState("networkidle");
    await scan(page);
  });

  test("parcel explorer", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/gis`);
    // The map keeps a WebGL render loop alive, so `networkidle` never settles here; waiting for
    // the table is the meaningful signal that the surface has rendered.
    await expect(page.getByRole("table")).toBeVisible();
    await scan(page);
  });

  test("parcel workspace", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/PRED-ZAM-004`);
    await expect(page.getByRole("heading", { name: "PRED-ZAM-004", level: 1 })).toBeVisible();
    await scan(page);
  });

  test("field surveys", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/field`);
    await page.waitForLoadState("networkidle");
    await scan(page);
  });

  test("parcel workspace visits", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/PRED-ZAM-001?tab=visitas`);
    await expect(page.getByRole("heading", { name: "PRED-ZAM-001", level: 1 })).toBeVisible();
    await scan(page);
  });

  test("provenance drawer open", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    await page.getByRole("link", { name: "Ver origen" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page);
  });
});
