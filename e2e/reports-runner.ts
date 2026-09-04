import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT } from "./fixtures";

/**
 * Make sure the chapter has at least one version before a spec looks at one.
 *
 * Playwright runs files alphabetically, so the accessibility and screenshot specs execute before
 * the journey that generates. Each makes its own through the real button and the real use-case,
 * rather than depending on an order nobody would notice breaking.
 */
export async function ensureVersion(page: Page): Promise<void> {
  await page.goto(`/t/${TENANT}/p/${PROJECT}/reports`);
  if ((await page.getByRole("link", { name: "v1" }).count()) > 0) return;
  await page.getByRole("button", { name: "Generar versión" }).click();
  await expect(page.getByRole("status")).toContainText("generada", { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "v1" })).toBeVisible();
}
