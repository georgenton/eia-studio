import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT } from "./fixtures";

/**
 * Make sure the chapter has at least one version before a spec looks at one.
 *
 * Playwright runs files alphabetically, so the accessibility and screenshot specs execute before
 * the journey that generates. Each makes its own through the real button and the real use-case,
 * rather than depending on an order nobody would notice breaking.
 *
 * `exact: true` throughout: versions accumulate across runs against the same database, and once
 * `v10` exists an inexact `v1` matches two links. That failure appears on the tenth run of a suite
 * that passed nine times, which is the worst moment for it to appear.
 */
export async function ensureVersion(page: Page): Promise<void> {
  await page.goto(`/t/${TENANT}/p/${PROJECT}/reports`);
  if ((await page.getByRole("link", { name: "v1", exact: true }).count()) > 0) return;
  await page.getByRole("button", { name: "Generar versión" }).click();
  await expect(page.getByRole("status")).toContainText("generada", { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "v1", exact: true })).toBeVisible();
}
