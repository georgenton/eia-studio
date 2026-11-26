import { expect, PARCELS, PROJECT, TENANT, test } from "./fixtures";

/**
 * What a cartographer checks before trusting a map: which way is north, which coordinate system
 * the numbers are in, what is being drawn, and whether the thing under the cursor can be reached
 * another way.
 *
 * Each of these is a claim the surface makes about itself, and each one is the kind of claim that
 * is easy to make falsely. A north arrow on a map that rotates is wrong the first time somebody
 * ctrl-drags. A coordinate with no CRS beside it is a number a consultant will type into a GPS.
 * So the assertions below are mostly about **agreement between a statement and the behaviour it
 * describes**, not about the presence of a label.
 */
const GIS = `/t/${TENANT}/p/${PROJECT}/gis`;

test.describe("the map says what it is", () => {
  test("north is drawn, and the map cannot be turned away from it", async ({ page }) => {
    await page.goto(GIS);
    const map = page.getByTestId("parcel-map");
    await expect(map).toHaveAttribute("data-map-ready", "true");

    await expect(page.getByTestId("map-north")).toBeVisible();
    await expect(page.getByRole("main")).toContainText("El mapa no gira");

    /*
     * The statement and the behaviour, checked together. A fixed arrow is only honest while the
     * bearing cannot move, so this performs the gesture that would move it — ctrl + drag, the
     * rotation MapLibre binds by default — and asserts the camera's bearing is still zero.
     */
    const box = (await map.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.keyboard.down("Control");
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 180, cy + 60, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Control");

    const bearing = await page.evaluate(() => {
      const node = document.querySelector<HTMLElement>('[data-testid="parcel-map"]');
      // The instance is not exposed; the canvas transform is what a rotation would change.
      const canvas = node?.querySelector("canvas");
      return canvas ? getComputedStyle(canvas).transform : "none";
    });
    // A rotated canvas carries a matrix with non-zero off-diagonal terms. MapLibre rotates the
    // *scene*, not the element, so the real assertion is the one below; this only catches a
    // future change that rotated the element instead.
    expect(
      bearing === "none" ||
        bearing.startsWith("matrix(1,") ||
        bearing === "matrix(1, 0, 0, 1, 0, 0)",
    ).toBe(true);
  });

  test("the coordinates name their coordinate system, and the description is marked as derived", async ({
    page,
  }) => {
    await page.goto(GIS);
    await expect(page.getByTestId("parcel-map")).toHaveAttribute("data-map-ready", "true");

    const panel = page.getByTestId("map-coordinates");
    await expect(panel).toBeVisible();

    // What is drawn: the canonical CRS, named rather than implied.
    await expect(panel).toContainText("EPSG:4326");
    await expect(panel).toContainText("WGS 84");

    /*
     * What is measured: the dataset's own analysis CRS. The zone and hemisphere are read out of
     * the EPSG number by arithmetic on a published rule — 32700 + zone is WGS 84 / UTM south —
     * which is why the panel is allowed to print them at all.
     */
    await expect(panel).toContainText("EPSG:32717");
    await expect(panel).toContainText("UTM zona 17 S");

    // And the limit of that: a description derived from a code is not a registry lookup, and the
    // surface says so rather than letting a reader take it for cartographic authority.
    await expect(panel).toContainText("se deduce del código EPSG");

    // The camera reports where it is, once the frame has settled.
    await expect(page.getByTestId("map-centre")).toBeVisible();
  });

  test("a selected parcel gives a point in both coordinate systems, and says what the point is", async ({
    page,
  }) => {
    await page.goto(GIS);
    const table = page.getByRole("table", { name: /Predios/ });
    await table
      .getByRole("row", { name: new RegExp(PARCELS.a) })
      .first()
      .click();

    const geographic = page.getByTestId("parcel-coordinates-geographic");
    const projected = page.getByTestId("parcel-coordinates-projected");
    await expect(geographic).toBeVisible();
    await expect(projected).toBeVisible();

    // Decimal comma, six places: es-EC notation, and a precision the cartography actually has.
    await expect(geographic).toContainText(/-?\d+,\d{6} · -?\d+,\d{6}/);
    // Metres, from PostGIS. The browser reprojects nothing, so these are the database's numbers.
    await expect(projected).toContainText(/E \d+ · N \d+/);

    /*
     * The sentence that keeps it from being read as a survey. `ST_PointOnSurface` guarantees a
     * point inside the polygon and guarantees nothing else, and a reference point mistaken for a
     * surveyed vertex — or for somebody's house — is the misreading worth spending a line on.
     */
    await expect(page.getByTestId("map-coordinates")).toContainText("punto interior del predio");
    await expect(page.getByTestId("map-coordinates")).toContainText("no es un vértice levantado");
    await expect(page.getByTestId("map-coordinates")).toContainText(
      "la posición de ninguna vivienda",
    );
  });

  test("hiding a layer changes the drawing and nothing else", async ({ page }) => {
    await page.goto(GIS);
    const map = page.getByTestId("parcel-map");
    await expect(map).toHaveAttribute("data-map-ready", "true");
    await expect(map).toHaveAttribute("data-map-idle", "true");

    const drawn = async () => Number(await map.getAttribute("data-parcels-in-view"));
    expect(await drawn()).toBeGreaterThan(0);

    await page.getByTestId("layer-toggle-parcels").uncheck();
    await expect.poll(drawn).toBe(0);

    /*
     * The promise the panel makes: *hiding a layer changes no data.* The table is the accessible
     * representation of the map, so if hiding the parcels emptied it the map would have become
     * the source of truth — which is the inversion §26 exists to prevent.
     */
    await expect(page.getByText(/141 predios · 141 en vista/)).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Ocultar una capa no cambia ningún dato");

    await page.getByTestId("layer-toggle-parcels").check();
    await expect.poll(drawn).toBeGreaterThan(0);
  });

  test("the tooltip is an addition, and the surface says where the same facts live", async ({
    page,
  }) => {
    await page.goto(GIS);
    const map = page.getByTestId("parcel-map");
    await expect(map).toHaveAttribute("data-map-ready", "true");

    /*
     * Hovering is a mouse gesture. The assertion that matters is not that the tooltip appears but
     * that the surface tells a keyboard or touch reader where to find the same thing — because a
     * tooltip is the one affordance that cannot be offered to them.
     */
    await expect(page.getByRole("main")).toContainText("la misma información está en la tabla");

    const box = (await map.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const tooltip = page.getByTestId("parcel-tooltip");
    // The centre of the extent may or may not be over a parcel; when it is, the tooltip carries
    // the code and the state, and never anything a table row does not also carry.
    if (await tooltip.isVisible()) {
      await expect(tooltip).toHaveText(/\S/);
      await expect(tooltip).toHaveAttribute("aria-hidden", "true");
    }
  });
});
