import { PARCELS, PROJECT, TENANT, test } from "./fixtures";

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
const OUT2 = "docs/screenshots/slice-2";
const OUT3 = "docs/screenshots/slice-3";

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
    // A capability the project *is* entitled to whose surface no slice has built yet. A capability
    // it is not entitled to answers 404 and has nothing to capture (ADR-016). This used to point
    // at FieldFlow; Slice 3 built it, so the example moved to the Quality Gate.
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/04-module-not-implemented.png` });
  });

  test("parcel explorer", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/gis`);
    await page.getByRole("table").waitFor();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT2}/01-parcel-explorer.png` });
  });

  test("parcel explorer with a parcel selected", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/gis`);
    await page.getByRole("table").waitFor();
    await page.waitForTimeout(1200);
    await page
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: `Abrir ${PARCELS.a}`, exact: true }) })
      .getByRole("button", { name: /Seleccionar/ })
      .click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT2}/02-parcel-selected.png` });
  });

  test("parcel workspace summary", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/${PARCELS.a}`);
    await page.getByRole("heading", { name: PARCELS.a, level: 1 }).waitFor();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT2}/03-parcel-workspace.png`, fullPage: true });
  });

  test("field surveys — coordinator", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/field`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT3}/05-field-coordinator.png`, fullPage: true });
  });

  test("parcel workspace — visits", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/${PARCELS.first}?tab=visitas`);
    await page.getByRole("heading", { name: PARCELS.first, level: 1 }).waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT3}/06-parcel-visits.png`, fullPage: true });
  });
});
