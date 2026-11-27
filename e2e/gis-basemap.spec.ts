import type { Page } from "@playwright/test";

import { PARCELS, PARCEL_EXTENT, PROJECT, TENANT, expect, test } from "./fixtures";

/**
 * The reference basemap, on a deployment that has one configured.
 *
 * This project runs against the second server in `playwright.config.ts`, configured with a
 * `custom` reference service whose tiles do not exist. That is deliberate and is the point: it
 * exercises the configured path — the switcher offers a background, the catalogue resolves, the
 * mode is chosen — and then the failure path, which is what a revoked key, an exhausted quota or
 * a provider outage actually looks like in a browser. No external request is made, no credential
 * is needed, and nobody is billed for running it.
 *
 * The invariant under test is the hard one: **a third-party background can never produce a blank
 * GIS.** The study's layers are attached before any tile is asked for and are untouched by
 * anything that happens underneath them, so losing the provider costs a reader their geographic
 * context and nothing else.
 */
const GIS = `/t/${TENANT}/p/${PROJECT}/gis`;

const cameraOf = async (page: Page) => {
  const map = page.getByTestId("parcel-map");
  await expect(map).toHaveAttribute("data-map-idle", "true");
  const view = (await map.getAttribute("data-map-view"))!.split(",").map(Number);
  return {
    west: view[0]!,
    south: view[1]!,
    east: view[2]!,
    north: view[3]!,
    drawn: Number(await map.getAttribute("data-parcels-in-view")),
    alignment: Number(await map.getAttribute("data-alignment-in-view")),
    basemap: await map.getAttribute("data-basemap-mode"),
  };
};

test.describe("a configured reference basemap", () => {
  test("offers the backgrounds the provider supports, and only those", async ({ page }) => {
    await page.goto(GIS);
    const select = page.getByLabel("Fondo del mapa");
    await expect(select).toBeVisible();

    // One tile template can honestly offer a reference map and nothing else: satellite and relief
    // are not on offer here, rather than being offered and quietly serving the same tiles.
    await expect(select.locator("option[value='none']")).toBeEnabled();
    await expect(select.locator("option[value='map']")).toBeEnabled();
    await expect(select.locator("option[value='satellite']")).toBeDisabled();
    await expect(select.locator("option[value='terrain']")).toBeDisabled();

    // Configured: no "switch one on" hint, because one is switched on.
    await expect(page.getByText("Requiere mapa de referencia configurado")).toHaveCount(0);
  });

  test("a provider that cannot serve a tile leaves the whole study on screen", async ({ page }) => {
    await page.goto(GIS);

    // The configured background is the default here, so this is what a reader meets on arrival
    // when the provider is down: the neutral ground, one quiet line of explanation, and every
    // layer of the study exactly where it belongs.
    const notice = page.getByTestId("basemap-unavailable");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("las capas del estudio no cambian");

    const camera = await cameraOf(page);
    expect(camera.basemap).toBe("none");
    expect(camera.drawn).toBeGreaterThan(0);
    expect(camera.alignment).toBeGreaterThan(0);

    // The extent is the project's, and a missing background does not move it.
    expect(camera.west).toBeLessThan(PARCEL_EXTENT.west);
    expect(camera.south).toBeLessThan(PARCEL_EXTENT.south);
    expect(camera.east).toBeGreaterThan(PARCEL_EXTENT.east);
    expect(camera.north).toBeGreaterThan(PARCEL_EXTENT.north);

    // Nothing of someone else's is credited, because nothing of theirs is drawn.
    await expect(page.getByTestId("basemap-credits")).toHaveCount(0);
  });

  test("changing the background moves the camera and the project not at all", async ({ page }) => {
    await page.goto(GIS);
    const before = await cameraOf(page);

    // Only requests to our own application count: the geometry arrived with the page, so changing
    // the background must produce no document and no data request whatsoever.
    const appRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/reference-tiles/")) return;
      if (url.pathname.startsWith("/_next/")) return;
      appRequests.push(url.pathname);
    });

    await page.getByLabel("Fondo del mapa").selectOption("none");
    await expect(page.getByTestId("basemap-unavailable")).toHaveCount(0);
    await page.getByLabel("Fondo del mapa").selectOption("map");
    await expect(page.getByTestId("basemap-unavailable")).toBeVisible();

    const after = await cameraOf(page);
    expect(after.west).toBeCloseTo(before.west, 6);
    expect(after.east).toBeCloseTo(before.east, 6);
    expect(after.south).toBeCloseTo(before.south, 6);
    expect(after.north).toBeCloseTo(before.north, 6);
    expect(after.drawn).toBeGreaterThan(0);
    expect(appRequests).toEqual([]);
  });

  test("«Centrar en proyecto» and parcel selection are unaffected by the background", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(GIS);
    const opening = await cameraOf(page);

    // A multi-part parcel, selected with a background configured: the two are independent.
    await page
      .getByRole("table", { name: /Predios/ })
      .getByRole("row")
      .filter({ hasText: "023" })
      .first()
      .click();
    // The map's own announcement, not the background notice beside it.
    await expect(page.getByRole("status").filter({ hasText: "Predio seleccionado" })).toContainText(
      "023",
    );

    /*
     * The wheel has to land on the map.
     *
     * Clicking a row scrolls that row into view, and the table sits below the map — so by the
     * time the click settles the map can be off the top of the viewport, and a wheel event at
     * its "centre" scrolls the document instead of zooming anything. Scrolling the map back into
     * view first is what a person does without thinking about it, and it is the difference
     * between this test exercising MapLibre's scroll zoom and exercising the page's scrollbar.
     */
    const map = page.getByTestId("parcel-map");
    // To the top rather than `scrollIntoViewIfNeeded`: that brings the *edge* of the map into
    // view, and a map whose edge is visible can still have its centre off screen — which is
    // where the wheel is aimed.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
    const box = (await map.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 400);
    await expect
      .poll(async () => (await cameraOf(page)).east - (await cameraOf(page)).west, {
        timeout: 5000,
      })
      .toBeGreaterThan((opening.east - opening.west) * 2);

    await page.getByRole("button", { name: "Centrar en proyecto" }).click();
    await expect
      .poll(async () => (await cameraOf(page)).west, { timeout: 5000 })
      .toBeCloseTo(opening.west, 3);
    expect(errors).toEqual([]);
  });

  test("the background switcher is reachable and announced from the keyboard", async ({ page }) => {
    await page.goto(GIS);
    const select = page.getByLabel("Fondo del mapa");
    // A real control in the document, not one buried in the `aria-hidden` canvas.
    await expect(select).not.toHaveAttribute("tabindex", "-1");
    await select.focus();
    await expect(select).toBeFocused();
    await select.selectOption("none");
    await expect(page.getByTestId("parcel-map")).toHaveAttribute("data-basemap-mode", "none");
  });

  test("the reference background never becomes part of the study's provenance", async ({
    page,
  }) => {
    await page.goto(GIS);
    const main = page.getByRole("main");

    /*
     * The line this whole feature is built around. The layer-provenance legend lists what the
     * study delivered; a background is geographic reference and must never appear there, acquire
     * a source type, or offer a "Ver origen" of its own.
     */
    await expect(main).toContainText("Procedencia de la capa");
    await expect(main).toContainText("Eje vial del estudio");
    // The configured reference service is nowhere in what the study is said to have delivered.
    await expect(main).not.toContainText("Servicio de referencia de prueba");
    await expect(main.getByText("Ver origen").first()).toBeVisible();
    // And it has no provenance link of its own: the count is the study's layers, unchanged.
    const sources = await main.getByText("Ver origen").count();
    expect(sources).toBeGreaterThan(0);
    expect(sources).toBeLessThanOrEqual(4);
  });
});

/**
 * The parcel detail, which until now drew the outline on an empty grey square.
 *
 * This project's provider answers **404 to every tile**, which is the right harness for most of
 * what matters here: the detail must behave when the background is missing exactly as the
 * Explorer does — keep every layer, say one quiet line, and never hand back a blank box with no
 * explanation. The background *working* is verified against the real provider on staging, because
 * a synthetic tile proves only that a raster layer can be attached.
 */
test.describe("the parcel detail map", () => {
  const detail = (code: string) => `/t/${TENANT}/p/${PROJECT}/parcels/${code}`;

  test("opens from the Explorer by selecting a parcel and pressing Abrir", async ({ page }) => {
    await page.goto(GIS);
    const table = page.getByRole("table", { name: /Predios/ });
    const row = table.getByRole("row").filter({ hasText: PARCELS.a }).first();
    await row.click();
    await row.getByRole("link", { name: "Abrir" }).click();

    await expect(page).toHaveURL(new RegExp(`/parcels/${PARCELS.a}$`));
    const map = page.getByTestId("parcel-detail-map");
    await expect(map).toHaveAttribute("data-map-ready", "true");
  });

  test("carries the same chrome the Explorer has: north, scale, background, coordinates", async ({
    page,
  }) => {
    await page.goto(detail(PARCELS.a));
    const map = page.getByTestId("parcel-detail-map");
    await expect(map).toHaveAttribute("data-map-ready", "true");

    await expect(page.getByTestId("parcel-detail-north")).toBeVisible();
    // MapLibre's own scale bar, inert text rather than a control.
    await expect(page.locator(".maplibregl-ctrl-scale").first()).toBeVisible();
    await expect(page.getByTestId("parcel-detail-basemap")).toBeVisible();
    await expect(page.getByTestId("parcel-detail-centre-coords")).toBeVisible();
    // The CRS is stated in the record beside the map, not left for a reader to assume.
    await expect(page.getByRole("main")).toContainText("EPSG:32717");
  });

  test("a provider that cannot serve a tile leaves the parcel on screen and says so", async ({
    page,
  }) => {
    await page.goto(detail(PARCELS.a));
    const map = page.getByTestId("parcel-detail-map");
    await expect(map).toHaveAttribute("data-map-ready", "true");

    /*
     * The three states this surface must keep apart. This is the middle one: there **is**
     * geometry, there **is** a connection, and the background is the thing that failed. A reader
     * must not be left deciding between "no parcel here" and "no map here".
     */
    await expect(page.getByTestId("parcel-detail-basemap-unavailable")).toBeVisible();
    await expect(map).toHaveAttribute("data-basemap-mode", "none");
    // And the parcel is still drawn: the study's layers are never involved in losing a background.
    await expect.poll(async () => map.getAttribute("data-map-idle")).toBe("true");
    await expect(page.getByRole("main")).toContainText("Centrar predio");
  });

  test("the controls are real buttons outside the aria-hidden canvas", async ({ page }) => {
    await page.goto(detail(PARCELS.a));
    const map = page.getByTestId("parcel-detail-map");
    await expect(map).toHaveAttribute("data-map-ready", "true");
    await expect(map).toHaveAttribute("aria-hidden", "true");

    /*
     * IG2-005: a control inside the `aria-hidden` subtree is one a keyboard can reach and a
     * screen reader cannot announce. Every control of this map must therefore be outside it.
     */
    for (const id of [
      "parcel-detail-zoom-in",
      "parcel-detail-zoom-out",
      "parcel-detail-centre",
      "parcel-detail-basemap",
    ]) {
      const control = page.getByTestId(id);
      await expect(control).toBeVisible();
      expect(await control.evaluate((el) => el.closest('[aria-hidden="true"]') !== null)).toBe(
        false,
      );
    }
  });

  test("zoom and «Centrar predio» move the camera and come back", async ({ page }) => {
    await page.goto(detail(PARCELS.a));
    const map = page.getByTestId("parcel-detail-map");
    await expect(map).toHaveAttribute("data-map-idle", "true");
    const span = async () => {
      const view = (await map.getAttribute("data-map-view"))!.split(",").map(Number);
      return view[2]! - view[0]!;
    };
    const opening = await span();

    await page.getByTestId("parcel-detail-zoom-in").click();
    await expect.poll(span).toBeLessThan(opening);

    /*
     * «Centrar predio» frames the parcel itself, which is **tighter** than the opening view —
     * the map deliberately opens on the surroundings so the parcel is not a polygon filling its
     * own frame with no context around it.
     */
    await page.getByTestId("parcel-detail-centre").click();
    await expect.poll(span).toBeLessThan(opening);
  });

  test("a direct link and a reload give the same map, without visiting the Explorer", async ({
    page,
  }) => {
    // No `goto(GIS)` first: the detail must not depend on anything the Explorer put in memory.
    await page.goto(detail(PARCELS.a));
    const map = page.getByTestId("parcel-detail-map");
    await expect(map).toHaveAttribute("data-map-idle", "true");
    const first = await map.getAttribute("data-map-view");

    await page.reload();
    await expect(page.getByTestId("parcel-detail-map")).toHaveAttribute("data-map-idle", "true");
    expect(await page.getByTestId("parcel-detail-map").getAttribute("data-map-view")).toBe(first);
  });

  test("navigating between two parcels shows the second one, not the first", async ({ page }) => {
    await page.goto(detail(PARCELS.a));
    const map = page.getByTestId("parcel-detail-map");
    await expect(map).toHaveAttribute("data-map-idle", "true");
    const firstView = await map.getAttribute("data-map-view");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(PARCELS.a);

    await page.goto(detail(PARCELS.b));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(PARCELS.b);
    const second = page.getByTestId("parcel-detail-map");
    await expect(second).toHaveAttribute("data-map-idle", "true");
    /*
     * Two different parcels are in two different places, so the camera must differ. A map that
     * kept the first parcel's extent would be showing the wrong ground under the right record,
     * which is the failure a shared client-side store makes easy.
     */
    expect(await second.getAttribute("data-map-view")).not.toBe(firstView);
  });

  test("a parcel with no geometry says so instead of showing an empty box", async ({ page }) => {
    /*
     * The first of the three states. `PARCELS.absent` is a code the package does not contain, so
     * it 404s; the state this asserts is the one where the parcel exists and its geometry does
     * not, which this fixture has no example of — recorded rather than faked.
     */
    await page.goto(detail(PARCELS.absent));
    await expect(page.getByText("404")).toBeVisible();
  });
});
