import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * The Slice 2 acceptance journey: Command Center → GIS / Parcel Explorer → shared selection →
 * Parcel Workspace, exactly as a reviewer performs it.
 */
const GIS = `/t/${TENANT}/p/${PROJECT}/gis`;

test.describe("GIS reviewer journey", () => {
  test("navigate from the Command Center to the Parcel Explorer", async ({ page }) => {
    // 1 · the rail now offers GIS as a real destination, not a placeholder
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    const rail = page.getByRole("navigation", { name: "Navegación principal" });
    await rail.getByRole("link", { name: "GIS & Predios" }).click();
    await expect(page).toHaveURL(new RegExp(`${GIS}$`));

    // 2 · tenant and project context survive the navigation (invariant 1)
    await expect(page.getByLabel("Organización")).toHaveValue(TENANT);
    await expect(page.getByLabel("Proyecto activo")).toHaveValue(PROJECT);
    await expect(page.getByRole("navigation", { name: "Ruta de navegación" })).toContainText(
      "GIS & Predios",
    );

    // 3 · the count states the whole set and the filtered subset
    await expect(page.getByText(/141 predios · 141 en vista/)).toBeVisible();
  });

  test("the historical 141 and the synthetic 141 are not presented as the same fact", async ({
    page,
  }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    const main = page.getByRole("main");

    // The KPI is the concluded study's verifiable universe.
    const kpi = main.locator("section", { hasText: "Universo estimado" }).first();
    await expect(kpi).toContainText("REAL_AGGREGATE");

    // The territorial summary counts the polygons we generated. Same number, different claim:
    // it is labelled SYNTHETIC and says the layer is not cadastre.
    const territory = main.locator("section", { hasText: "Resumen territorial" }).first();
    await expect(territory).toContainText("141");
    await expect(territory).toContainText("SYNTHETIC");
    await expect(territory).toContainText("no es catastro");
    await expect(territory).not.toContainText("REAL_AGGREGATE");
  });

  test("map and table are one selection", async ({ page }) => {
    await page.goto(GIS);
    const table = page.getByRole("table", { name: /Predios/ });

    // 4 · the table is the accessible representation of the map: every parcel is a row
    const row = table.getByRole("row").filter({ hasText: "PRED-ZAM-004" });
    await expect(row).toBeVisible();

    // 5 · selecting a row selects the parcel everywhere
    await row.getByRole("button", { name: /Seleccionar/ }).click();
    await expect(row.getByRole("button", { name: /Seleccionar/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("status")).toContainText("PRED-ZAM-004");

    // 6 · the contextual panel describes the selected parcel and nothing else
    const panel = page.getByRole("complementary");
    await expect(panel).toContainText("PRED-ZAM-004");
    await expect(panel).toContainText("Predio seleccionado");

    // 7 · exactly one parcel is selected at a time
    const other = table.getByRole("row").filter({ hasText: "PRED-ZAM-005" });
    await other.getByRole("button", { name: /Seleccionar/ }).click();
    await expect(other.getByRole("button", { name: /Seleccionar/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(row.getByRole("button", { name: /Seleccionar/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("filters narrow table and count coherently", async ({ page }) => {
    await page.goto(GIS);

    // 8 · a status filter reduces the set to the parcels that carry that state
    await page.getByRole("checkbox", { name: /En verificación/ }).check();
    await expect(page.getByText(/141 predios · 2 en vista/)).toBeVisible();

    // 9 · a search that matches nothing gives the empty-filter state, not an empty page
    await page.getByRole("checkbox", { name: /En verificación/ }).uncheck();
    await page.getByLabel("Buscar predio").fill("no-existe-este-codigo");
    await expect(page.getByText(/Ningún predio coincide/)).toBeVisible();
    await expect(page.getByText(/141 predios · 0 en vista/)).toBeVisible();
  });

  test("the layer legend states what each layer actually is", async ({ page }) => {
    await page.goto(GIS);

    // 10 · every map carries the layer-provenance legend (product language rules)
    const legend = page.getByText("Procedencia de la capa");
    await expect(legend).toBeVisible();
    const main = page.getByRole("main");
    await expect(main).toContainText("RECONSTRUCTED ALIGNMENT");
    await expect(main).toContainText("eje aproximado, dibujado hasta recibir el GIS oficial");
    await expect(main).toContainText("SYNTHETIC PARCELS");
    await expect(main).toContainText("polígonos generados · no es catastro");
    // The base map we do not have is not claimed.
    await expect(main).not.toContainText("REAL BASE MAP");
  });

  test("open the Parcel Workspace from the selected parcel", async ({ page }) => {
    await page.goto(GIS);
    const table = page.getByRole("table", { name: /Predios/ });
    const row = table.getByRole("row").filter({ hasText: "PRED-ZAM-004" });
    await row.getByRole("button", { name: /Seleccionar/ }).click();

    // 11 · the parcel is the master territorial workspace (invariant 7)
    await page.getByRole("link", { name: "Abrir Parcel Workspace" }).click();
    await expect(page).toHaveURL(/\/parcels\/PRED-ZAM-004$/);
    await expect(page.getByRole("heading", { name: "PRED-ZAM-004", level: 1 })).toBeVisible();

    // 12 · the summary states the territorial facts and their provenance
    const main = page.getByRole("main");
    await expect(main).toContainText("Ficha territorial");
    await expect(main).toContainText("Punto medio del frente sobre la vía");
    await expect(main.getByText("SYNTHETIC").first()).toBeVisible();

    // 13 · tabs whose modules do not exist say so instead of inventing content
    await page.getByRole("link", { name: "Visitas" }).click();
    await expect(main).toContainText("Visitas: aún sin datos");
    await expect(main).toContainText("field.surveys");
  });

  test("parcel provenance opens the same one drawer", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/PRED-ZAM-004`);
    await page.getByRole("link", { name: "Ver origen de los datos del predio" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Régimen");
    await expect(drawer).toContainText("Simulación de demostración");
    await expect(drawer).toContainText("corridor-generator@1");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("a parcel of another project is not reachable by guessing its code", async ({ page }) => {
    const response = await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/PRED-ZAM-999`);
    expect(response?.status()).toBe(404);
  });
});
