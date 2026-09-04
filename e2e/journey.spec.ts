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
    await page.getByRole("link", { name: "Abrir el centro de control" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${TENANT}/p/${PROJECT}$`));

    // 4 · the shell keeps tenant and project context visible
    await expect(page.getByRole("navigation", { name: "Ruta de navegación" })).toContainText(
      "Centro de control",
    );
    await expect(page.getByLabel("Organización")).toHaveValue(TENANT);
    await expect(page.getByLabel("Proyecto activo")).toHaveValue(PROJECT);

    // 5 · capability-driven navigation
    const rail = page.getByRole("navigation", { name: "Navegación principal" });
    await expect(rail.getByRole("link", { name: "Centro de control" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Cartografía y predios" })).toBeVisible();
    // Reports became a real destination in Slice 7; the rail has no placeholder row left.
    await expect(rail.getByRole("link", { name: "Informes" })).toBeVisible();

    // 6 · the four approved historical aggregate facts, read from the KPI strip. The strip is
    // scoped explicitly because 141 also appears in the territorial summary, where it is a
    // count of synthetic polygons rather than the study's universe (see gis.spec.ts).
    const main = page.getByRole("main");
    await expect(main).toContainText("7,4 km");
    const strip = main.getByRole("group", { name: "Control de ejecución" });
    await expect(strip.getByText("141", { exact: true })).toBeVisible();
    await expect(strip.getByText("119", { exact: true })).toBeVisible();
    // The consultation figure has its own panel rather than a strip cell.
    await expect(main.getByText("185", { exact: true })).toBeVisible();

    // 7 · historical values are visibly distinguishable from the demo simulation
    await expect(main.getByText("Dato histórico").first()).toBeVisible();
    await expect(main.getByText("Simulación operativa").first()).toBeVisible();
    await expect(main.getByText("Simulación operativa").first()).toBeVisible();

    // 8 · the forecast is stated as arithmetic, never as a prediction
    await expect(main).toContainText("sin modelo predictivo");
    await expect(main).toContainText("operational-forecast@1");

    // 9 · demo values declare the scenario they belong to, not "today"
    await expect(main).toContainText("Escenario demo · fecha de corte: 17 sep 2026");
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
    // The badge is explained in words, in the place where the reader is deciding what to quote.
    await expect(drawer).toContainText("Cifra verificable del expediente");
    await expect(drawer).toContainText("Validación humana");

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
