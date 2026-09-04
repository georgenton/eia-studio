import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { PARCEL_CODE_PATTERN, expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * The technician surface on the device it was designed for: accessibility, the refused-location
 * path, and the mobile screenshots.
 *
 * The location tests are the ones worth reading. A technician who declines the browser prompt, or
 * whose device simply cannot get a fix under a canopy, must still be able to do the work — and
 * the record must say *why* there is no coordinate rather than showing a plausible one. Nothing in
 * this suite ever asserts a real position: the granted case uses the fixture's synthetic point on
 * the reconstructed corridor.
 */
const FIELD = `/t/${TENANT}/p/${PROJECT}/field`;
const OUT = "docs/screenshots/slice-3";
const BLOCKING = new Set(["serious", "critical"]);

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
  const report = blocking.map(
    (v) =>
      `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node(s))\n    ${v.nodes[0]?.target.join(" ")}`,
  );
  expect(blocking, `axe violations:\n  ${report.join("\n  ")}`).toEqual([]);
}

/** An assignment that still has work on it, opened the way a technician opens one. */
async function openPendingAssignment(page: Page): Promise<boolean> {
  await page.goto(FIELD);
  const card = page
    .getByRole("link")
    .filter({ hasText: /Iniciar visita/ })
    .first();
  if ((await card.count()) === 0) return false;
  await card.click();
  await expect(page).toHaveURL(/\/field\/assignments\//);
  return true;
}

test.describe("FieldFlow · the technician's device", () => {
  test("My Work passes the accessibility scan", async ({ page }) => {
    await page.goto(FIELD);
    await expect(page.getByRole("heading", { name: "Mi trabajo", level: 1 })).toBeVisible();
    await scan(page);
  });

  test("an assignment with its questionnaire passes the accessibility scan", async ({ page }) => {
    await page.goto(FIELD);
    await page.getByRole("link").filter({ hasText: PARCEL_CODE_PATTERN }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await scan(page);
  });

  test("a submitted response — read-only — passes the accessibility scan", async ({ page }) => {
    await page.goto(FIELD);
    const done = page.getByRole("link").filter({ hasText: "Ver ficha enviada" }).first();
    await expect(done).toBeVisible();
    await done.click();
    await expect(page.getByRole("main").getByText(/ya no puede editarse/)).toBeVisible();
    await scan(page);
  });

  test("a refused location is recorded as refused, and the visit continues", async ({
    page,
    context,
  }) => {
    // Take the permission away for this test only: the project grants it, so this is the
    // technician pressing "Block" — not a misconfigured fixture.
    await context.clearPermissions();

    if (!(await openPendingAssignment(page))) test.skip(true, "no pending assignment left to open");

    await page.getByRole("button", { name: "Iniciar visita" }).click();

    const main = page.getByRole("main");
    // The outcome is named in the visit block, in the technician's language.
    await expect(main.getByText("Permiso de ubicación denegado")).toBeVisible({
      timeout: 20_000,
    });
    // And the work is not blocked by it: the questionnaire is there to fill in.
    await expect(page.getByRole("button", { name: "Guardar borrador" })).toBeVisible();
    await expect(main).not.toContainText("Ubicación capturada");

    await scan(page);
    await page.screenshot({ path: `${OUT}/04-location-denied.png`, fullPage: true });

    await context.grantPermissions(["geolocation"]);
  });

  test("mobile screenshots", async ({ page }) => {
    await page.goto(FIELD);
    await expect(page.getByRole("heading", { name: "Mi trabajo", level: 1 })).toBeVisible();
    await page.screenshot({ path: `${OUT}/01-my-work-mobile.png`, fullPage: true });

    await page.getByRole("link").filter({ hasText: PARCEL_CODE_PATTERN }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.screenshot({ path: `${OUT}/02-assignment-mobile.png`, fullPage: true });

    await page.goto(FIELD);
    const done = page.getByRole("link").filter({ hasText: "Ver ficha enviada" }).first();
    if ((await done.count()) > 0) {
      await done.click();
      await expect(page.getByRole("main").getByText(/ya no puede editarse/)).toBeVisible();
      await page.screenshot({ path: `${OUT}/03-submitted-mobile.png`, fullPage: true });
    }
  });
});
