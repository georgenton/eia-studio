import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * Live validation of the real provider, run by hand — **never in CI**.
 *
 * It is not in any Playwright project's `testMatch`, so `pnpm e2e` cannot pick it up and CI can
 * never make a billable request. It is run deliberately, against a local server configured with
 * the real key, to produce the four screenshots and to look at what the imagery actually does to
 * the study's layers:
 *
 *   MAPTILER_KEY=… BASEMAP_PROVIDER=maptiler pnpm --filter @eia/web start &
 *   npx playwright test e2e/basemap-live.spec.ts --project=coordinator
 *
 * The key is restricted to the Preview hostname — correctly — and the Preview itself sits behind
 * deployment protection, so the tile requests are re-signed here with that origin's `Referer`.
 * Nothing is broadened at the provider and no header change is shipped: this is the owner's own
 * account, asked for the owner's own tiles, to see them before a consultancy does.
 */
const GIS = `/t/${TENANT}/p/${PROJECT}/gis`;
const ALLOWED_ORIGIN = "https://eia-studio-web-git-main-georgentons-projects.vercel.app/";
const OUT = "docs/screenshots/slice-2";

const MODES = [
  ["satellite", "05-basemap-satelite"],
  ["map", "06-basemap-mapa"],
  ["terrain", "07-basemap-relieve"],
  ["none", "04-basemap-sin-fondo"],
] as const;

test.describe("live reference basemap", () => {
  test.beforeEach(async ({ page }) => {
    /*
     * The key is restricted to the Preview origin — correctly — and the Preview is behind
     * deployment protection, so neither this browser nor a headless visit can reach the tiles as
     * themselves. Chromium also refuses to let a test set `Referer` on the page's own `fetch`.
     *
     * So each tile request is re-issued from Node, where the header can be set, and the real
     * response is handed back to the page unchanged. The bytes are the provider's, fetched with
     * the owner's key through the origin the owner allowed; only the hop is different. Nothing is
     * broadened at the provider and nothing about this leaves the file.
     */
    await page.route("https://api.maptiler.com/**", async (route) => {
      try {
        // Bounded: a hung upstream request would otherwise leave the page's availability probe
        // waiting for ever, which looks exactly like a product bug and is not one.
        const upstream = await fetch(route.request().url(), {
          headers: { Referer: ALLOWED_ORIGIN },
          signal: AbortSignal.timeout(20_000),
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        await route.fulfill({
          status: upstream.status,
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
            "access-control-allow-origin": "*",
          },
          body,
        });
      } catch {
        // A handler that throws leaves the browser's request hanging for ever, which is the one
        // outcome that would be mistaken for a fault in the product. Answer, and let the surface
        // do what it does with a provider that will not serve.
        await route.fulfill({ status: 502, body: "" }).catch(() => {});
      }
    });
  });

  for (const [mode, file] of MODES) {
    test(`mode:${mode}`, async ({ page }) => {
      const tiles: number[] = [];
      page.on("response", (r) => {
        if (r.url().startsWith("https://api.maptiler.com/")) tiles.push(r.status());
      });

      page.on("response", (r) => {
        if (r.url().startsWith("https://api.maptiler.com/")) {
          console.log(
            "TILE",
            r.status(),
            r
              .url()
              .replace(/key=[^&]+/, "key=<redacted>")
              .slice(0, 90),
          );
        }
      });
      await page.goto(GIS);
      await page.getByRole("table").waitFor();
      // Let the opening background settle before asking for another: the availability probe is a
      // real request to the provider, and switching mid-flight is a different case from this one.
      await expect
        .poll(async () => page.getByTestId("parcel-map").getAttribute("data-basemap-mode"), {
          timeout: 30_000,
        })
        .not.toBeNull();
      await page.getByLabel("Fondo del mapa").selectOption(mode);
      const tilesBeforeSwitch = tiles.length;
      // The background is only attached once the provider has answered the availability probe,
      // so this waits for the answer rather than for a render.
      await expect
        .poll(async () => page.getByTestId("parcel-map").getAttribute("data-basemap-mode"), {
          timeout: 30_000,
        })
        .toBe(mode);
      await expect(page.getByTestId("parcel-map")).toHaveAttribute("data-map-idle", "true");
      await page.waitForTimeout(3500);

      const tilesAfterSwitch = tiles.slice(tilesBeforeSwitch);
      const map = page.getByTestId("parcel-map");
      // The project is on screen whatever is behind it: parcels drawn, centreline drawn.
      expect(Number(await map.getAttribute("data-parcels-in-view"))).toBeGreaterThan(0);
      expect(Number(await map.getAttribute("data-alignment-in-view"))).toBeGreaterThan(0);

      if (mode === "none") {
        // Not "no tiles at all": the surface opens on the configured default, so tiles were
        // fetched before the switch. What matters is that choosing `Sin fondo` stops asking.
        expect(tilesAfterSwitch).toEqual([]);
        await expect(page.getByTestId("basemap-credits")).toHaveCount(0);
      } else {
        // Real tiles, really served, for the background actually chosen.
        expect(tilesAfterSwitch.length + tilesBeforeSwitch).toBeGreaterThan(0);
        expect(tiles.filter((s) => s !== 200)).toEqual([]);
        await expect(page.getByTestId("basemap-credits")).toContainText("MapTiler");
        await expect(page.getByTestId("basemap-credits")).toContainText("OpenStreetMap");
        await expect(page.getByTestId("basemap-credits")).toContainText("Mapa de referencia");
      }
      await expect(page.getByTestId("basemap-unavailable")).toHaveCount(0);
      await page.screenshot({ path: `${OUT}/${file}.png` });
    });
  }

  /** The case that decides whether the palette survives imagery: a parcel picked out of it. */
  test("mode:satellite-selected", async ({ page }) => {
    await page.goto(GIS);
    await page.getByRole("table").waitFor();
    await expect
      .poll(async () => page.getByTestId("parcel-map").getAttribute("data-basemap-mode"), {
        timeout: 30_000,
      })
      .toBe("satellite");
    /*
     * Zoom in *first*, so the parcel is off screen when it is picked and the map eases to it. At
     * corridor scale a 5 ha parcel is a few pixels, and the question this screenshot exists to
     * answer — can a reader see which parcel they picked, over imagery? — can only be answered at
     * the scale somebody actually works at.
     */
    const box = (await page.getByTestId("parcel-map").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 5; i += 1) await page.mouse.wheel(0, -400);
    await page.waitForTimeout(2500);
    await page
      .getByRole("table", { name: /Predios/ })
      .getByRole("row")
      .filter({ hasText: "023" })
      .first()
      .click();
    await expect(page.getByRole("status").filter({ hasText: "Predio seleccionado" })).toContainText(
      "023",
    );
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/08-basemap-satelite-seleccion.png` });
  });
});
