import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT } from "./fixtures";

/**
 * Make sure this project has findings before a spec looks at one.
 *
 * Playwright runs files alphabetically, so the accessibility and screenshot specs execute before
 * the journey that produces the findings. Rather than couple them to that order — an ordering
 * dependency nobody would notice breaking — each makes its own, through the real button and the
 * real use-case.
 *
 * Idempotent by construction: the rule set reconciles on a fingerprint, so running it twice
 * updates rather than duplicating. That is the property the journey spec asserts directly.
 */
export async function ensureFindings(page: Page): Promise<void> {
  await page.goto(`/t/${TENANT}/p/${PROJECT}/quality`);
  const rows = page.getByRole("row").filter({ hasText: /^QG-/ });
  if ((await rows.count()) > 0) return;

  await page.getByRole("button", { name: "Ejecutar revisión" }).click();
  await expect(page.getByRole("status")).toContainText("Revisión ejecutada", { timeout: 30_000 });
  await expect(rows.first()).toBeVisible();
}

/**
 * Put a finding back in `OPEN`, whatever a previous run of this suite left it in.
 *
 * A decision is permanent by design, so a spec that settles a finding changes the environment for
 * the next run — and an e2e suite that only passes against a freshly wiped database is a suite
 * that will be quietly disabled the first time someone runs it twice. Reopening is itself a real,
 * justified decision, which is why this can be done through the product rather than around it.
 */
export async function ensureOpen(page: Page, code: string): Promise<void> {
  await page.goto(`/t/${TENANT}/p/${PROJECT}/quality/${code}`);
  const decision = page.getByLabel("Decisión");
  const values = await decision
    .locator("option")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  // `REOPEN` is offered only from a settled state, so its presence *is* the check.
  if (!values.includes("REOPEN")) return;
  await decision.selectOption("REOPEN");
  await page
    .getByLabel("Justificación")
    .fill("Se reabre para dejar el hallazgo en su estado inicial de revisión.");
  await page.getByRole("button", { name: "Registrar decisión" }).click();
  await expect(page.getByRole("status")).toContainText("→ OPEN", { timeout: 30_000 });
  await page.reload();
}
