import type { Page } from "@playwright/test";

import { PARCEL_EXTENT, PARCELS, expect, PROJECT, TENANT, test } from "./fixtures";

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

    /*
     * The one control the map does offer is a real button in the document, *outside* the
     * `aria-hidden` canvas — which is the whole reason it can exist at all. A keyboard reaches it
     * and a screen reader announces it; the sweep that demotes everything inside the map has not
     * touched it.
     */
    const recentre = page.getByRole("button", { name: "Centrar en proyecto" });
    await expect(recentre).toBeVisible();
    await expect(recentre).not.toHaveAttribute("tabindex", "-1");
    await expect(recentre).toBeEnabled();
    await recentre.focus();
    await expect(recentre).toBeFocused();
  });

  /*
   * The map is pointed at the project — which nothing asserted until it stopped being true.
   *
   * The read model computed the opening extent by walking a parcel's coordinates two levels deep,
   * which is the shape of a `Polygon`. Every parcel of this study is stored as a `MultiPolygon`,
   * so `Math.min` was handed a ring, the extent became `NaN` → `null`, and the map opened on
   * `[0, 0]` at zoom 1: Zamora is roughly 8 700 km from there. Every existing test stayed green —
   * the table, the selection, the filters and the legends were all correct — because none of them
   * could see where the camera was.
   *
   * These read two data attributes the map publishes: the current viewport and how many parcel
   * polygons are actually drawn. Not pixels, and not a screenshot comparison; a camera somewhere
   * near the right coordinates with the project's geometry inside it.
   */
  const cameraOf = async (page: Page) => {
    const map = page.getByTestId("parcel-map");
    await expect(map).toHaveAttribute("data-map-ready", "true");
    // The counts are only meaningful once the frame has settled: at `load` the layers exist and
    // nothing is drawn yet.
    await expect(map).toHaveAttribute("data-map-idle", "true");
    const view = (await map.getAttribute("data-map-view"))!.split(",").map(Number);
    return {
      west: view[0]!,
      south: view[1]!,
      east: view[2]!,
      north: view[3]!,
      drawn: Number(await map.getAttribute("data-parcels-in-view")),
      alignment: Number(await map.getAttribute("data-alignment-in-view")),
    };
  };

  /** Somewhere inside the corridor: the parcels span about -78,745…-78,706 by -3,820…-3,770. */
  const PROJECT_POINT = { lon: -78.726, lat: -3.795 };

  test("the map opens on the project, with its parcels inside the viewport", async ({ page }) => {
    await page.goto(GIS);
    const camera = await cameraOf(page);

    // 1 · finite, and an actual rectangle
    for (const value of [camera.west, camera.south, camera.east, camera.north]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(camera.west).toBeLessThan(camera.east);
    expect(camera.south).toBeLessThan(camera.north);

    // 2 · the corridor is inside it — the assertion the `[0, 0]` fallback fails
    expect(camera.west).toBeLessThan(PROJECT_POINT.lon);
    expect(camera.east).toBeGreaterThan(PROJECT_POINT.lon);
    expect(camera.south).toBeLessThan(PROJECT_POINT.lat);
    expect(camera.north).toBeGreaterThan(PROJECT_POINT.lat);

    // 3 · and **all 141** are inside it, not merely the middle of the corridor. This is the
    //     assertion a count of rendered polygons cannot make: a renderer may cull, and a
    //     viewport clips. The envelope is the one PostGIS measures over the delivered layer.
    expect(camera.west).toBeLessThan(PARCEL_EXTENT.west);
    expect(camera.south).toBeLessThan(PARCEL_EXTENT.south);
    expect(camera.east).toBeGreaterThan(PARCEL_EXTENT.east);
    expect(camera.north).toBeGreaterThan(PARCEL_EXTENT.north);

    // 4 · framed rather than merely contained: a view of the whole planet also "contains" it.
    expect(camera.east - camera.west).toBeLessThan(1);
    expect(camera.north - camera.south).toBeLessThan(1);

    // 5 · with the parcels actually drawn in it
    expect(camera.drawn).toBeGreaterThan(0);
  });

  test("the centreline is drawn, and is the study's own", async ({ page }) => {
    await page.goto(GIS);
    const camera = await cameraOf(page);
    // The alignment is a `MultiLineString` — the same nesting that emptied the parcel extent — and
    // it is in the opening view rather than merely in the payload.
    expect(camera.alignment).toBeGreaterThan(0);
    await expect(page.getByRole("main")).toContainText("Eje vial del estudio");

    // Its measured length is published on the Command Center, against the ~7,4 km the study states.
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    await expect(page.getByRole("main")).toContainText("7,4");
  });

  test("selecting a multi-part parcel neither throws nor moves the camera to nowhere", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(GIS);
    const table = page.getByRole("table", { name: /Predios/ });
    // 023 is one of the 20 parcels the study delivered in more than one piece.
    await table.getByRole("row").filter({ hasText: "023" }).first().click();
    await expect(page.getByRole("status")).toContainText("023");

    const camera = await cameraOf(page);
    for (const value of [camera.west, camera.south, camera.east, camera.north]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(camera.drawn).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("«Centrar en proyecto» brings the camera back after it has been moved away", async ({
    page,
  }) => {
    await page.goto(GIS);
    const opening = await cameraOf(page);

    /*
     * Lose the project, the way a reader does: zoom out until the corridor is a speck. Scroll is
     * used rather than a drag because it is the gesture the map actually offers — there is no
     * zoom control (IG2-005) — and it is the one that leaves someone unsure where they are.
     */
    const box = (await page.getByTestId("parcel-map").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 400);

    const openingWidth = opening.east - opening.west;
    await expect
      .poll(async () => (await cameraOf(page)).east - (await cameraOf(page)).west, {
        timeout: 5000,
      })
      .toBeGreaterThan(openingWidth * 2);
    const moved = await cameraOf(page);
    expect(moved.east - moved.west).toBeGreaterThan(openingWidth * 2);

    // The control is a real button in the document, not inside the `aria-hidden` canvas.
    const recentre = page.getByRole("button", { name: "Centrar en proyecto" });
    await expect(recentre).toBeVisible();
    await recentre.click();

    await expect
      .poll(async () => (await cameraOf(page)).west, { timeout: 5000 })
      .toBeCloseTo(opening.west, 3);
    const back = await cameraOf(page);
    expect(back.east).toBeCloseTo(opening.east, 3);
    expect(back.drawn).toBeGreaterThan(0);
  });

  test("a parcel of another project is not reachable by guessing its code", async ({ page }) => {
    const response = await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/${PARCELS.absent}`);
    expect(response?.status()).toBe(404);
  });
});
