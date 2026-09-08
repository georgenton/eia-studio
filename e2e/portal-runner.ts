import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT } from "./fixtures";

export const PORTAL = `/t/${TENANT}/p/${PROJECT}/portal`;
export const CLIENT_VIEW = `/portal/${TENANT}/${PROJECT}`;

/**
 * Make sure the project has a publication before a spec opens the client's page.
 *
 * Playwright runs files alphabetically, so the accessibility and screenshot specs execute before
 * the journey that publishes. Each makes its own through the real button and the real use-case,
 * rather than depending on an order nobody would notice breaking.
 */
export async function ensurePublication(page: Page): Promise<void> {
  await page.goto(PORTAL);
  if ((await page.getByRole("cell", { name: "v1", exact: true }).count()) > 0) return;
  await page.getByRole("button", { name: /Publicar/ }).click();
  await expect(page.getByRole("status")).toContainText("Publicada", { timeout: 30_000 });
  await expect(page.getByRole("cell", { name: "v1", exact: true })).toBeVisible();
}
