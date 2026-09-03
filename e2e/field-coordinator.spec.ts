import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * FieldFlow as a coordinator sees it.
 *
 * The assertions read the numbers off the screen and check they are *consistent with each other*
 * rather than pinning literals, because the technician suite mutates the same campaign. What must
 * never drift is the relationship: submitted ≤ total, and the demo campaign is never confused with
 * the concluded study's 119 socioeconomic surveys.
 */
const FIELD = `/t/${TENANT}/p/${PROJECT}/field`;

test.describe("FieldFlow · coordinator", () => {
  test("the rail offers FieldFlow as a real destination", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    const rail = page.getByRole("navigation", { name: "Navegación principal" });
    await rail.getByRole("link", { name: "Field Surveys" }).click();
    await expect(page).toHaveURL(new RegExp(`${FIELD}$`));
    await expect(page.getByLabel("Organización")).toHaveValue(TENANT);
    await expect(page.getByLabel("Proyecto activo")).toHaveValue(PROJECT);
  });

  test("the demo campaign shows progress counted from the field tables", async ({ page }) => {
    await page.goto(FIELD);
    const main = page.getByRole("main");

    await expect(main).toContainText("Campaña de campo — demostración");
    // The version label is what a response resolves against, so it is on screen for traceability.
    await expect(main).toContainText("v1");
    await expect(main.getByText("SYNTHETIC").first()).toBeVisible();

    const counts = async (label: string) => {
      const item = main
        .locator("li")
        .filter({ hasText: new RegExp(`^${label}`) })
        .first();
      return Number((await item.locator("strong").innerText()).replace(/\D/g, ""));
    };
    const total = await counts("Asignadas");
    const pending = await counts("Pendientes");
    const inProgress = await counts("En curso");
    const completed = await counts("Completadas");
    const submitted = await counts("Enviadas");

    // Counted, not asserted as literals: the technician journey submits against this campaign.
    expect(total).toBeGreaterThan(0);
    expect(pending + inProgress + completed).toBe(total);
    expect(submitted).toBeLessThanOrEqual(total);
    expect(submitted).toBeGreaterThan(0);
  });

  test("the capture channel states honestly that it has no offline support", async ({ page }) => {
    await page.goto(FIELD);
    const main = page.getByRole("main");
    await expect(main).toContainText("Captura web de EIA Studio");
    await expect(main).toContainText("no hay cola offline");
    // The one thing this surface must never say.
    await expect(main).not.toContainText("Offline disponible");
  });

  test("workload is counts per technician, not anybody's answers", async ({ page }) => {
    await page.goto(FIELD);
    const table = page.getByRole("table", { name: /Asignaciones por técnico/ });
    await expect(table).toBeVisible();
    await expect(table).toContainText("Técnico de campo 1");
    await expect(table).toContainText("Técnico de campo 2");
    await expect(page.getByRole("main")).toContainText("field.responses.read");
  });

  test("the Command Center separates the demo campaign from the historical 119", async ({
    page,
  }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    const main = page.getByRole("main");

    // The concluded study's aggregate, in the KPI strip, badged REAL_AGGREGATE.
    const strip = main.getByRole("group", { name: "Control de ejecución" });
    await expect(strip.getByText("119", { exact: true })).toBeVisible();
    await expect(strip).toContainText("REAL_AGGREGATE");

    // The running operation, in its own panel, badged SYNTHETIC and saying so in words.
    const field = main.locator("section", { hasText: "Campaña de campo en curso" }).first();
    await expect(field).toContainText("fichas enviadas");
    await expect(field).toContainText("SYNTHETIC");
    await expect(field).toContainText("No forma parte de las encuestas socioeconómicas");
    await expect(field).not.toContainText("REAL_AGGREGATE");
  });
});
