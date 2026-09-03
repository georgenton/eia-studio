import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT, test } from "./fixtures";
import { ensureFindings } from "./quality-runner";

/**
 * Accessibility of the Quality Gate states.
 *
 * Three states, because they are three different problems: a list where severity and state are
 * carried by chips, a detail page whose whole argument is two panels of equal weight, and a form
 * whose submit button is disabled until a justification is long enough — a pattern that is easy to
 * make invisible to a screen reader.
 *
 * Same caveat as the rest of the axe suite: a scanner catches a minority of accessibility
 * problems. A green run is a regression net, not a conformance claim.
 */
const BLOCKING = new Set(["serious", "critical"]);
const QUALITY = `/t/${TENANT}/p/${PROJECT}/quality`;

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

test.describe("Quality Gate · accessibility", () => {
  // The findings only exist once the rule set has run, and this file may execute first.
  test.beforeEach(async ({ page }) => {
    await ensureFindings(page);
  });

  test("the findings list", async ({ page }) => {
    await page.goto(QUALITY);
    await expect(page.getByText("Reglas vigentes")).toBeVisible();
    await scan(page);
  });

  test("a finding's two sources and its reasoning", async ({ page }) => {
    await page.goto(`${QUALITY}/QG-002`);
    await expect(page.getByText("Fuente A")).toBeVisible();
    await scan(page);
  });

  test("severity and state are words, not only colours", async ({ page }) => {
    await page.goto(QUALITY);
    const main = page.getByRole("main");
    // The chips carry text. A reader who cannot distinguish the tones still reads the meaning.
    await expect(main.getByText("Alta", { exact: true }).first()).toBeVisible();
    await expect(main.getByText("Abierto", { exact: true }).first()).toBeVisible();
  });
});
