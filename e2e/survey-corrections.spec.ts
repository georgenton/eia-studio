import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * Correcting a submitted response, in a browser, end to end (ADR-038).
 *
 * The journey a consultancy actually walks: a technician's response is already in; somebody who may
 * read it notices it is wrong and asks for it to be captured again; the technician receives a
 * **revisit** rather than a reopened form; the new capture becomes what the analysis means; and the
 * old one is still there, marked *Sustituida*.
 *
 * The one thing it asserts about the interface is a word that must never appear: at no point is a
 * submitted response offered for editing or deletion.
 */
const FIELD = `/t/${TENANT}/p/${PROJECT}/field`;
const REASON =
  "La informante corrige la relación con el predio: es arrendataria, no propietaria ocupante.";

/** The technician's own submitted response, found rather than pinned to a fixture id. */
async function findSubmittedAssignment(page: Page): Promise<string> {
  await page.goto(FIELD);
  const cards = page.getByRole("main").locator('a[href*="/field/assignments/"]');
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  const hrefs = (await cards.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLAnchorElement).getAttribute("href")),
  )) as Array<string | null>;

  for (const href of hrefs) {
    if (!href) continue;
    await page.goto(href);
    const main = page.getByRole("main");
    if ((await main.getByText("Enviada", { exact: true }).count()) > 0) return href;
  }
  throw new Error("no submitted response found for this technician");
}

test.describe("A submitted response is corrected, never edited", () => {
  test.describe.configure({ mode: "serial" });

  let responseHref = "";

  test("a technician's submitted response offers nobody an edit", async ({ browser }) => {
    const technician = await browser.newPage({ storageState: "e2e/.auth/technician.json" });
    responseHref = await findSubmittedAssignment(technician);

    const main = technician.getByRole("main");
    // The words that must never be on offer once a response has been submitted.
    await expect(main).not.toContainText("Editar respuesta enviada");
    await expect(main).not.toContainText("Eliminar respuesta");
    // A technician holds no `field.corrections.request`, so they are offered none either.
    await expect(main.getByRole("button", { name: "Solicitar corrección" })).toHaveCount(0);
    await technician.close();
  });

  test("a coordinator asks for it to be captured again, with a reason", async ({ browser }) => {
    const coordinator = await browser.newPage({ storageState: "e2e/.auth/coordinator.json" });
    await coordinator.goto(responseHref);
    const main = coordinator.getByRole("main");

    await expect(main).toContainText("Historial de la respuesta");
    // Requesting one is not offered as an edit, and the panel says what a correction is.
    await expect(main).toContainText("Ninguna respuesta se modifica");

    await main.getByLabel("¿Qué hay que corregir?").fill(REASON);
    await main.getByRole("button", { name: "Solicitar corrección" }).click();
    await expect(main).toContainText("Corrección solicitada", { timeout: 30_000 });

    /*
     * The assumption this line exists to prevent: that asking has already taken the figure out of
     * the analysis. It has not, and will not until somebody captures the correction.
     */
    await expect(main).toContainText("sigue siendo la vigente para el análisis");
    await coordinator.close();
  });

  test("the technician receives a revisit rather than a reopened form", async ({ browser }) => {
    const technician = await browser.newPage({ storageState: "e2e/.auth/technician.json" });
    await technician.goto(FIELD);
    const main = technician.getByRole("main");

    // The work list marks it, with the reason, before it is opened.
    await expect(main).toContainText("Corrección solicitada", { timeout: 30_000 });
    await expect(main).toContainText("arrendataria");
    await technician.close();
  });

  test("and reads the same way in English", async ({ browser }) => {
    const coordinator = await browser.newPage({ storageState: "e2e/.auth/coordinator.json" });
    await coordinator.goto(responseHref);
    // The reader's choice is a cookie, so the surface renders in English on the server.
    await coordinator
      .context()
      .addCookies([{ name: "eia.locale", value: "en", url: coordinator.url() }]);
    await coordinator.reload();
    const main = coordinator.getByRole("main");
    await expect(main).toContainText("Response history");
    await expect(main).toContainText("Correction requested");
    // The vocabulary holds in both languages, including the word that is deliberately absent.
    await expect(main).not.toContainText("Edit submitted response");
    await coordinator.close();
  });
});
