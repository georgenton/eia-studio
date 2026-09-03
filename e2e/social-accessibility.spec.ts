import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * Accessibility of the Social Intelligence states (Slice 4 §61).
 *
 * Four states, because they are four different problems: a table of figures, a queue of text, a
 * proposal carrying a status, and a form of checkboxes with long descriptions. The last one is the
 * one worth scanning hardest — it is where a specialist spends the day, and where category chips
 * could easily have become colour-only affordances.
 *
 * Same caveat as the rest of the axe suite: a scanner catches a minority of accessibility
 * problems. A green run is a regression net, not a conformance claim.
 */
const BLOCKING = new Set(["serious", "critical"]);
const SOCIAL = `/t/${TENANT}/p/${PROJECT}/social`;

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

test.describe("Social Intelligence · accessibility", () => {
  test("deterministic tabulation", async ({ page }) => {
    await page.goto(SOCIAL);
    await expect(page.getByRole("main")).toContainText("Tabulación");
    await scan(page);
  });

  test("workflow overview and validated themes", async ({ page }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    await expect(page.getByRole("main")).toContainText("Temas validados");
    await scan(page);
  });

  test("the open-response queue, filtered to low confidence", async ({ page }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    await page.getByRole("button", { name: "Confianza baja" }).click();
    await scan(page);
  });

  test("the review workspace, with its category selection open", async ({ page }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    const review = page.getByRole("button", { name: "Revisar y decidir" }).first();
    if ((await review.count()) === 0) {
      // Everything is reviewed already; the state under test is the queue's reviewed view, which
      // the previous test covers. Skipping is honest — inventing a proposal to scan would not be.
      test.skip();
      return;
    }
    await review.click();
    await expect(page.getByRole("main")).toContainText("Categorías de esta versión");
    await scan(page);
  });

  test("category chips carry text, not only colour", async ({ page }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    const main = page.getByRole("main");
    // A provisional proposal and a validated coding are told apart by their labels — "provisional,
    // sin validar" and "Codificación validada por especialista" — and by border style, never by
    // hue alone. Asserted as text so a colour-blind reader's experience is the tested one.
    await expect(main).toContainText("provisional, sin validar");
    const status = await main.innerText();
    expect(status).toMatch(/Propuesta lista|Validada|En cola|Clasificación fallida/);
  });
});
