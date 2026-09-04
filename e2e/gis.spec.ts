import { PARCELS, expect, PROJECT, TENANT, test } from "./fixtures";

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
    await rail.getByRole("link", { name: "Cartografía y predios" }).click();
    await expect(page).toHaveURL(new RegExp(`${GIS}$`));

    // 2 · tenant and project context survive the navigation (invariant 1)
    await expect(page.getByLabel("Organización")).toHaveValue(TENANT);
    await expect(page.getByLabel("Proyecto activo")).toHaveValue(PROJECT);
    await expect(page.getByRole("navigation", { name: "Ruta de navegación" })).toContainText(
      "Cartografía y predios",
    );

    // 3 · the count states the whole set and the filtered subset
    await expect(page.getByText(/141 predios · 141 en vista/)).toBeVisible();
  });

  test("the study's published 141 and the imported layer's 141 are still two claims", async ({
    page,
  }) => {
    /*
     * Until the cartographic package arrived these two numbers were a real aggregate beside 141
     * invented polygons, and the test's job was to keep them apart. Both are real now — and the
     * job is unchanged. One is what the concluded study published; the other is how many polygons
     * the consultancy's layer contains. They agree today, and a reader must still be able to see
     * that they are different statements, because the next delivery may make them disagree.
     */
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    const main = page.getByRole("main");

    const strip = main.getByRole("group", { name: "Control de ejecución" });
    await expect(strip).toContainText("Universo estimado");
    await expect(strip).toContainText("Dato histórico");

    const territory = main.locator("section", { hasText: "Resumen territorial" }).first();
    await expect(territory).toContainText("141");
    // The layer is the study's own survey, and says so rather than claiming to be a registry.
    await expect(territory).not.toContainText("Dato histórico");
  });

  test("map and table are one selection", async ({ page }) => {
    await page.goto(GIS);
    const table = page.getByRole("table", { name: /Predios/ });

    // 4 · the table is the accessible representation of the map: every parcel is a row
    const row = table
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: `Abrir ${PARCELS.a}`, exact: true }) });
    await expect(row).toBeVisible();

    // 5 · selecting a row selects the parcel everywhere
    await row.getByRole("button", { name: /Seleccionar/ }).click();
    await expect(row.getByRole("button", { name: /Seleccionar/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("status")).toContainText(PARCELS.a);

    // 6 · the contextual panel describes the selected parcel and nothing else
    const panel = page.getByRole("complementary");
    await expect(panel).toContainText(PARCELS.a);
    await expect(panel).toContainText("Predio seleccionado");

    // 7 · exactly one parcel is selected at a time
    const other = table
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: `Abrir ${PARCELS.b}`, exact: true }) });
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
    // 20 of the 141 real parcels carry `INCOMPLETO` in the package's own `ESTADO` column, which
    // the import maps to `estimated` — the boundary exists, the field work behind it does not yet.
    await page.getByRole("checkbox", { name: /En verificación/ }).check();
    await expect(page.getByText(/141 predios · 20 en vista/)).toBeVisible();

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
    // The alignment now comes from the official package, so the legend says so — and the
    // reconstructed-axis caveat is gone because there is nothing left to caveat.
    await expect(main).toContainText("Eje vial del estudio");
    await expect(main).not.toContainText("Eje reconstruido");
    await expect(main).not.toContainText("Predios simulados");

    /*
     * The parcels are real, and the legend still refuses to call them cadastre: they are the
     * consultancy's own survey, delivered with owner names that had to be stripped before the
     * layer could be stored at all. "Official cadastre" would lend a registry's authority to a
     * surveyor's file (ADR-023).
     */
    await expect(main).toContainText("Capa del estudio");
    await expect(main).toContainText("no es catastro oficial");
    await expect(main).not.toContainText("Catastro oficial");

    // The influence areas the study delimited are a layer of their own, labelled as such.
    await expect(main).toContainText("Área delimitada por el estudio");

    // The base map we do not have is still not claimed.
    await expect(main).not.toContainText("REAL BASE MAP");
  });

  test("open the Parcel Workspace from the selected parcel", async ({ page }) => {
    await page.goto(GIS);
    const table = page.getByRole("table", { name: /Predios/ });
    const row = table
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: `Abrir ${PARCELS.a}`, exact: true }) });
    await row.getByRole("button", { name: /Seleccionar/ }).click();

    // 11 · the parcel is the master territorial workspace (invariant 7)
    await page.getByRole("link", { name: "Abrir Parcel Workspace" }).click();
    await expect(page).toHaveURL(new RegExp(`/parcels/${PARCELS.a}$`));
    await expect(page.getByRole("heading", { name: PARCELS.a, level: 1 })).toBeVisible();

    // 12 · the summary states the territorial facts and their provenance
    const main = page.getByRole("main");
    await expect(main).toContainText("Ficha territorial");
    // The abscissa is the one the consultancy wrote on the field sheet, not one this product
    // inferred from a centroid. The distinction is on screen because the method is (ADR-023).
    await expect(main).toContainText("Declarada en ficha de campo");
    await expect(main).not.toContainText("Proyección del centroide sobre el eje");
    await expect(main).not.toContainText("Simulación operativa");

    // 13 · the Visits tab is field work, and since Slice 3 it has some: state, questionnaire
    // version and provenance, never the answers themselves.
    await page.getByRole("link", { name: "Visitas" }).click();
    await expect(main).toContainText("Visitas de campo");

    // 14 · tabs whose modules do not exist still say so instead of inventing content
    await page.getByRole("link", { name: "Instrumentos" }).click();
    await expect(main).toContainText("Instrumentos: aún sin datos");
  });

  test("parcel provenance opens the same one drawer", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/${PARCELS.a}`);
    await page.getByRole("link", { name: "Ver origen de los datos del predio" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Régimen");
    /*
     * The boundary is a fact of a concluded study, not a simulation — and the drawer says both
     * how it arrived and what was done to it. `Anonimizado` is the honest half: the layer reached
     * this product only after every owner-bearing attribute was stripped from it, and a reader who
     * wants to know why a name is missing can find the answer here.
     */
    await expect(drawer).toContainText("Histórico observado");
    await expect(drawer).toContainText("Dataset importado");
    await expect(drawer).toContainText("Anonimizado");
    await expect(drawer).not.toContainText("Simulación de demostración");
    await expect(drawer).not.toContainText("corridor-generator@1");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("the whole journey works from the keyboard, without touching the map", async ({ page }) => {
    // IG2-005: the map is `aria-hidden` and holds no control at all — no zoom buttons, because a
    // visible control only a mouse can use is worse than no control. Everything the surface
    // offers must therefore be reachable through the table.
    await page.goto(GIS);
    const table = page.getByRole("table", { name: /Predios/ });
    await expect(table).toBeVisible();

    // Nothing inside the map is focusable.
    const focusableInMap = await page
      .locator('[aria-hidden="true"]')
      .locator('button, a[href], [tabindex]:not([tabindex="-1"])')
      .count();
    expect(focusableInMap).toBe(0);

    // Reach the selection control of a specific parcel by tabbing, never by clicking.
    const select = table
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: `Abrir ${PARCELS.a}`, exact: true }) })
      .getByRole("button", { name: /Seleccionar/ });
    await select.focus();
    await expect(select).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status")).toContainText(PARCELS.a);

    // Open the Parcel Workspace from the keyboard.
    const open = page.getByRole("link", { name: "Abrir Parcel Workspace" });
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/parcels/${PARCELS.a}$`));
    await expect(page.getByRole("heading", { name: PARCELS.a, level: 1 })).toBeVisible();

    // And inspect provenance from the keyboard.
    const provenance = page.getByRole("link", { name: "Ver origen de los datos del predio" });
    await provenance.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Régimen");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("the map offers no control that only a mouse can operate", async ({ page }) => {
    await page.goto(GIS);
    await expect(page.getByRole("table", { name: /Predios/ })).toBeVisible();
    // MapLibre's NavigationControl is not added (IG2-005); the scale bar is inert text.
    await expect(page.locator(".maplibregl-ctrl-zoom-in")).toHaveCount(0);
    await expect(page.locator(".maplibregl-ctrl-zoom-out")).toHaveCount(0);
    await expect(page.locator(".maplibregl-ctrl-scale")).toHaveCount(1);
  });

  test("a parcel of another project is not reachable by guessing its code", async ({ page }) => {
    const response = await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/${PARCELS.absent}`);
    expect(response?.status()).toBe(404);
  });
});
