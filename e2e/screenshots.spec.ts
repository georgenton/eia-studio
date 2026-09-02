import { PROJECT, TENANT, test } from "./fixtures";

/**
 * Implementation screenshots at the golden references' viewport (1440 px wide).
 *
 * These are **our** baseline from here on. They are not compared pixel-for-pixel with the design
 * bundle's captures: the bundle is a fidelity reference for hierarchy, spacing, typography and
 * density, not a pixel specification (design README, "Visual reference hierarchy").
 *
 * Run with `pnpm e2e:screenshots`; the files are committed under docs/screenshots/slice-1/.
 */
const OUT = "docs/screenshots/slice-1";

test.describe("implementation screenshots", () => {
  test("portfolio", async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/01-portfolio.png`, fullPage: true });
  });

  test("command center", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/02-command-center.png`, fullPage: true });
  });

  test("provenance drawer", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    await page.getByRole("link", { name: "Ver origen" }).first().click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: `${OUT}/03-provenance-drawer.png` });
  });

  test("module enabled but not implemented", async ({ page }) => {
    // A capability the project *is* entitled to whose surface this slice has not built. A
    // capability it is not entitled to answers 404 and has nothing to capture (ADR-016).
    await page.goto(`/t/${TENANT}/p/${PROJECT}/gis`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/04-module-not-implemented.png` });
  });
});
