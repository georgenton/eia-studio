import { PROJECT, TENANT, test } from "./fixtures";
import { ensureFindings } from "./quality-runner";

/**
 * Golden references for the slice report. Not visual-regression assertions: they are the images a
 * reviewer looks at, regenerated whenever the surface changes.
 */
const QUALITY = `/t/${TENANT}/p/${PROJECT}/quality`;
const shot = (name: string) => `docs/screenshots/slice-5/${name}.png`;

test.describe("Slice 5 screenshots", () => {
  // The findings only exist once the rule set has run, and this file may execute first.
  test.beforeEach(async ({ page }) => {
    await ensureFindings(page);
  });

  test("the findings list", async ({ page }) => {
    await page.goto(QUALITY);
    await page.getByText("Reglas vigentes").waitFor();
    await page.screenshot({ path: shot("01-quality-gate"), fullPage: true });
  });

  test("a numerical discrepancy, both sources at equal weight", async ({ page }) => {
    await page.goto(`${QUALITY}/QG-001`);
    await page.getByText("Fuente A").waitFor();
    await page.screenshot({ path: shot("02-finding-evidence"), fullPage: true });
  });

  test("the interdisciplinary finding", async ({ page }) => {
    await page.goto(`${QUALITY}/QG-004`);
    await page.getByText("Fuente A").waitFor();
    await page.screenshot({ path: shot("03-finding-interdisciplinary"), fullPage: true });
  });
});
