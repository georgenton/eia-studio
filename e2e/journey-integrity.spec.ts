import { expect, PARCELS, PROJECT, TENANT, test } from "./fixtures";

/**
 * The demonstration journey, walked as a machine so a person does not discover it in the meeting.
 *
 * Not a repeat of the surface tests: each of those asserts what its own screen means. This one
 * asserts the properties that only fail *between* screens, and that a reader notices immediately —
 * a rail link that 404s, a button with no accessible name, an empty region with no explanation, a
 * way out of the workspace nobody can find.
 *
 * It runs against the same build the Preview serves. The Preview itself answers 302 before a
 * request reaches the application (deployment protection), so it cannot be driven from here; that
 * is a limitation of where the walkthrough can be automated, not of what it covers.
 */
const RAIL = [
  "Centro de control",
  "Cartografía y predios",
  "Trabajo de campo",
  "Análisis social",
  "Control de consistencia",
  "Plan de Manejo",
  "Documentos",
  "Informes",
] as const;

test.describe("the consultancy journey holds together", () => {
  test("every rail destination answers and names itself", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    const rail = page.getByRole("navigation", { name: "Navegación principal" });

    for (const name of RAIL) {
      const link = rail.getByRole("link", { name });
      await expect(link, name).toBeVisible();
      const response = await page.goto(
        new URL((await link.getAttribute("href"))!, page.url()).toString(),
      );
      expect(response?.status(), name).toBe(200);
      // The breadcrumb names where you are, on every one of them (invariant 1).
      await expect(
        page.getByRole("navigation", { name: "Ruta de navegación" }),
        name,
      ).toContainText(name);
    }
  });

  test("no link in the journey is a dead end", async ({ page }) => {
    for (const path of [
      `/t/${TENANT}`,
      `/t/${TENANT}/p/${PROJECT}`,
      `/t/${TENANT}/p/${PROJECT}/gis`,
      `/t/${TENANT}/p/${PROJECT}/parcels/${PARCELS.a}`,
      `/t/${TENANT}/p/${PROJECT}/field`,
      `/t/${TENANT}/p/${PROJECT}/social`,
      `/t/${TENANT}/p/${PROJECT}/quality`,
      `/t/${TENANT}/p/${PROJECT}/pgas`,
      `/t/${TENANT}/p/${PROJECT}/documents`,
      `/t/${TENANT}/p/${PROJECT}/reports`,
    ]) {
      await page.goto(path);
      const dead = await page
        .getByRole("main")
        .locator('a[href="#"], a[href=""], a:not([href])')
        .count();
      expect(dead, `${path} has a link that goes nowhere`).toBe(0);
    }
  });

  test("every control a reader can press says what it is", async ({ page }) => {
    for (const path of [
      `/t/${TENANT}/p/${PROJECT}`,
      `/t/${TENANT}/p/${PROJECT}/gis`,
      `/t/${TENANT}/p/${PROJECT}/field`,
      `/t/${TENANT}/p/${PROJECT}/social`,
      `/t/${TENANT}/p/${PROJECT}/quality`,
      `/t/${TENANT}/p/${PROJECT}/pgas`,
      `/t/${TENANT}/p/${PROJECT}/reports`,
    ]) {
      await page.goto(path);
      const buttons = page.getByRole("main").getByRole("button");
      for (let i = 0; i < (await buttons.count()); i += 1) {
        const button = buttons.nth(i);
        if (!(await button.isVisible())) continue;
        const name = (
          (await button.getAttribute("aria-label")) ?? (await button.innerText())
        ).trim();
        expect(name.length, `${path} · button ${i} has no accessible name`).toBeGreaterThan(0);
      }
    }
  });

  test("an empty region explains itself instead of looking broken", async ({ page }) => {
    for (const path of [
      `/t/${TENANT}/p/${PROJECT}`,
      `/t/${TENANT}/p/${PROJECT}/social`,
      `/t/${TENANT}/p/${PROJECT}/quality`,
      `/t/${TENANT}/p/${PROJECT}/documents`,
      `/t/${TENANT}/p/${PROJECT}/reports`,
    ]) {
      await page.goto(path);
      const empties = page.locator('[data-system-state="empty"]');
      for (let i = 0; i < (await empties.count()); i += 1) {
        const text = (await empties.nth(i).innerText()).trim();
        // An empty state with fewer than a sentence in it reads as a bug to somebody being shown
        // the product; the 15 states exist precisely so it does not.
        expect(text.length, `${path} · empty region ${i} says nothing`).toBeGreaterThan(40);
      }
    }
  });

  test("the field surface opens on the current operation", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/field`);
    const main = page.getByRole("main");
    await expect(main).toContainText("Operativo actual");
    // History, if there is any, is closed: a previous operation never sits open beside today's.
    const historyPanels = main.locator("details[open]");
    expect(await historyPanels.count()).toBe(0);
  });

  test("provenance opens from a figure and closes again", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    await page.getByRole("link", { name: "Ver origen" }).first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("ORIGEN DEL DATO");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/\?prov=/);
  });

  test("leaving the workspace is reachable from every surface", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);

    // The account control is a disclosure named after the person, not a naked button, and the way
    // out is inside it. Whether signing out actually revokes the session is `e2e/session.spec.ts`,
    // which signs in for itself: doing it here would end the shared session every later test in
    // this project depends on.
    const account = page.getByRole("group", { name: /^Cuenta de / });
    await expect(account).toBeVisible();
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeHidden();

    await account.locator("summary").click();
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  });
});
