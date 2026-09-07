import type { Page } from "@playwright/test";

import { expect, PARCEL_EXTENT, PROJECT, TENANT, test } from "./fixtures";

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

    const box = (await page.getByTestId("parcel-map").boundingBox())!;
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
