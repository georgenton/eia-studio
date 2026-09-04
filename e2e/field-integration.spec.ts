import type { Page } from "@playwright/test";

import { PARCEL_CODE_PATTERN, PARCELS, expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * The join between FieldFlow and the surfaces that were already there.
 *
 * A survey that a technician submits is only useful if it shows up where the territory is
 * discussed — the Parcel Workspace — and where the coordinator judges progress — the campaign
 * panel and the Command Center. This suite walks that seam as a coordinator, and it asserts
 * *relationships* rather than literals, because the technician suite submits against the same
 * campaign and a pinned number would be a fixture assertion pretending to be a product one.
 *
 * The one thing it does pin is the separation the study depends on: the concluded study's
 * socioeconomic aggregate and the running demo campaign are two different figures with two
 * different regimes, and neither is ever presented as the other.
 */
const FIELD = `/t/${TENANT}/p/${PROJECT}/field`;

/** Read one campaign count off the overview list. */
async function campaignCount(page: Page, label: string) {
  const item = page
    .getByRole("main")
    .locator("li")
    .filter({ hasText: new RegExp(`^${label}`) })
    .first();
  return Number((await item.locator("strong").innerText()).replace(/\D/g, ""));
}

test.describe("FieldFlow · what a submitted survey changes elsewhere", () => {
  test("a parcel with field work shows its visit history, its state and its provenance", async ({
    page,
  }) => {
    // Which parcels the campaign worked is a property of the fixture, so the parcel is *found*
    // rather than named: the campaign takes the corridor's first parcels by chainage, and the
    // explorer orders by the same key, so walking the first rows reaches one that has a visit.
    await page.goto(`/t/${TENANT}/p/${PROJECT}/gis`);
    await expect(page.getByRole("table")).toBeVisible();
    const codes = (
      await page.getByRole("cell").filter({ hasText: PARCEL_CODE_PATTERN }).allInnerTexts()
    )
      .map((text) => text.trim())
      .slice(0, 8);

    let worked: string | null = null;
    for (const code of codes) {
      await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/${code}?tab=visitas`);
      await expect(page.getByRole("heading", { name: code, level: 1 })).toBeVisible();
      if ((await page.getByText("No hay visitas registradas").count()) === 0) {
        worked = code;
        break;
      }
    }
    expect(worked, "no visited parcel among the campaign's first parcels").not.toBeNull();

    const table = page.getByRole("table");
    // The state of the work, the questionnaire version it was answered against, and where the
    // record came from. Not the answers: those are Social Intelligence's surface, later.
    await expect(table).toContainText("Técnico de campo");
    await expect(table).toContainText("v1");
    await expect(page.getByRole("main").getByText("SYNTHETIC").first()).toBeVisible();

    // A visit's location outcome is stated, never inferred.
    await expect(table).toContainText(
      /Ubicación (capturada|no disponible|no solicitada)|Permiso de ubicación denegado/,
    );
  });

  test("a parcel with no field work says so, rather than showing an empty table", async ({
    page,
  }) => {
    // The far end of the corridor: 141 synthetic parcels, 12 assignments.
    await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/${PARCELS.noFieldWork}?tab=visitas`);
    await expect(page.getByRole("heading", { name: PARCELS.noFieldWork, level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("No hay visitas registradas");
  });

  test("campaign progress and the Command Center panel agree with each other", async ({ page }) => {
    await page.goto(FIELD);
    const total = await campaignCount(page, "Asignadas");
    const submitted = await campaignCount(page, "Enviadas");
    expect(total).toBeGreaterThan(0);
    expect(submitted).toBeGreaterThan(0);
    expect(submitted).toBeLessThanOrEqual(total);

    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    const panel = page
      .getByRole("main")
      .locator("section", { hasText: "Campaña de campo en curso" })
      .first();
    await expect(panel).toBeVisible();
    // The same two numbers, counted from the same tables by the same read model.
    await expect(panel).toContainText(String(submitted));
    await expect(panel).toContainText(String(total));
  });

  test("the running campaign is never merged into the concluded study's aggregate", async ({
    page,
  }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    const main = page.getByRole("main");

    const strip = main.getByRole("group", { name: "Control de ejecución" });
    await expect(strip).toContainText("REAL_AGGREGATE");

    const panel = main.locator("section", { hasText: "Campaña de campo en curso" }).first();
    await expect(panel).toContainText("SYNTHETIC");
    await expect(panel).toContainText("No forma parte de las encuestas socioeconómicas");
    await expect(panel).not.toContainText("REAL_AGGREGATE");

    // Each figure carries its own provenance, reachable from where it is shown.
    await expect(panel.getByRole("link", { name: /Ver origen/ })).toBeVisible();
  });

  test("the questionnaire is readable as a definition, and cannot be edited from any surface", async ({
    page,
  }) => {
    await page.goto(FIELD);
    const main = page.getByRole("main");
    await expect(main).toContainText("v1");
    // Slice 3 renders published questionnaires; it does not author them. No surface offers it.
    await expect(page.getByRole("button", { name: /Editar cuestionario/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Nueva versión/ })).toHaveCount(0);
  });
});
