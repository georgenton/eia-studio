import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * The Slice 1 acceptance journey, exactly as a reviewer performs it.
 */
test.describe("reviewer journey", () => {
  test("sign in, choose the project, read the Command Center and inspect provenance", async ({
    page,
  }) => {
    // 2 · the Portfolio shows the authorized project and nothing else
    await page.goto(`/t/${TENANT}`);
    await expect(page.getByRole("heading", { name: "Portfolio", level: 1 })).toBeVisible();
    const projectLink = page.getByRole("link", { name: /Vía Puente del Amor/ });
    await expect(projectLink).toBeVisible();

    // 3 · enter the project
    await page.getByRole("link", { name: "Abrir Command Center" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${TENANT}/p/${PROJECT}$`));

    // 4 · the shell keeps tenant and project context visible
    await expect(page.getByRole("navigation", { name: "Ruta de navegación" })).toContainText(
      "Command Center",
    );
    await expect(page.getByLabel("Organización")).toHaveValue(TENANT);
    await expect(page.getByLabel("Proyecto activo")).toHaveValue(PROJECT);

    // 5 · capability-driven navigation
    const rail = page.getByRole("navigation", { name: "Navegación principal" });
    await expect(rail.getByRole("link", { name: "Command Center" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "GIS & Predios" })).toBeVisible();
    // Reports is ANNOUNCED: shown as a placeholder, never as a link.
    await expect(rail.getByRole("link", { name: "Reports" })).toHaveCount(0);
    await expect(rail).toContainText("Reports");

    // 6 · the four approved historical aggregate facts
    const main = page.getByRole("main");
    await expect(main).toContainText("7,4 km");
    await expect(main.getByText("141", { exact: true })).toBeVisible();
    await expect(main.getByText("119", { exact: true })).toBeVisible();
    await expect(main.getByText("185", { exact: true })).toBeVisible();

    // 7 · historical values are visibly distinguishable from the demo simulation
    await expect(main.getByText("REAL_AGGREGATE").first()).toBeVisible();
    await expect(main.getByText("SYNTHETIC").first()).toBeVisible();
    await expect(main.getByText("DEMO / SYNTHETIC")).toBeVisible();

    // 8 · the forecast is stated as arithmetic, never as a prediction
    await expect(main).toContainText("sin modelo predictivo");
    await expect(main).toContainText("operational-forecast@1");
  });

  test("the provenance drawer opens from a KPI, shows real facets and closes with Escape", async ({
    page,
  }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);

    await page.getByRole("link", { name: "Ver origen" }).first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/\?prov=/);

    // The four facets come from the database, not from a stored source type.
    await expect(drawer).toContainText("Régimen");
    await expect(drawer).toContainText("Origen");
    await expect(drawer).toContainText("Transformaciones");
    await expect(drawer).toContainText("Granularidad");
    await expect(drawer).toContainText("ETIQUETA DERIVADA DE LAS FACETAS");
    await expect(drawer).toContainText("Human validation");

    await expect(page.getByRole("button", { name: "Cerrar", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/\?prov=/);
  });

  test("a demo value and a historical value declare different regimes", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);

    const links = page.getByRole("link", { name: "Ver origen" });
    await links.first().click();
    await expect(page.getByRole("dialog")).toContainText("Histórico observado");
    await page.keyboard.press("Escape");

    // The forecast panel's own provenance is a demo simulation.
    await page.getByRole("link", { name: "Ver origen" }).nth(8).click();
    await expect(page.getByRole("dialog")).toContainText("Simulación de demostración");
  });
});
