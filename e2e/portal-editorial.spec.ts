import AxeBuilder from "@axe-core/playwright";
import { buildJpegWithGps, buildPdf, buildPptx } from "@eia/testing/documents";

import type { Browser, Page } from "@playwright/test";

import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * The public presentation, driven the way a person drives it.
 *
 * The domain is covered by integration tests. What only a browser can show is the part this
 * block exists for: that somebody with the right permission can **do** it — pick a file, see it
 * upload, describe it, save, publish — and that a visitor with no session gets exactly what was
 * published and nothing else.
 *
 * Everything here is synthetic: the demo tenant the suite seeds, a JPEG this file builds with a
 * real EXIF/GPS segment, a two-page PDF and an empty PPTX. No real consultancy, no real person,
 * no delivered file.
 */
const EDITOR = `/t/${TENANT}/p/${PROJECT}/portal/editorial`;
const PUBLIC_PROJECT = `/p/${TENANT}/${PROJECT}`;
const PUBLIC_TENANT = `/p/${TENANT}`;

/**
 * A visitor, built rather than assumed: an empty storage state is the only honest way to say
 * "no session". Reusing the authenticated context with a logged-out flag would be testing a flag.
 */
async function visit(browser: Browser, path: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const response = await page.goto(path);
  return { context, page, status: response?.status() ?? 0 };
}

const FIRM = "Consultora Sintética";
const ENGAGEMENT = "Programa Ambiental Sintético";
const HEADLINE = `Vía sintética ${Date.now().toString(36)}`;
const SECTION_TEXT =
  "Cobertura vegetal mayormente intervenida a lo largo del corredor. Texto sintético de prueba.";
const MEMBER = "Persona Sintética Uno";

/** `\xFF\xD8\xFF`, written as numbers so no escape survives a file round-trip as something else. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/**
 * A scanner catches a minority of accessibility problems, so a green run is a regression net and
 * not a conformance claim — the same caveat the rest of the axe suite carries.
 */
const BLOCKING = new Set(["serious", "critical"]);

async function scan(page: Page, where: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
  const report = blocking.map(
    (v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} node(s))`,
  );
  expect(blocking, `axe violations on ${where}:\n  ${report.join("\n  ")}`).toEqual([]);
}

/** Golden references for this block; regenerated whenever the surface changes. */
const shot = (name: string) => `docs/screenshots/vision-ambiental/${name}.png`;

/**
 * A page a phone can read: nothing wider than the window.
 *
 * Horizontal overflow is the one responsive failure that makes a public page unusable rather than
 * merely ugly — a visitor cannot reach what is off to the right — and it is the one a viewport
 * screenshot hides, because the screenshot is as wide as the content.
 */
async function assertNoHorizontalOverflow(page: Page, where: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${where} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
}

test.describe.configure({ mode: "serial" });

test.describe("Presentación pública · el recorrido completo", () => {
  test("A · un administrador nombra la consultora, y persiste", async ({ page }) => {
    await page.goto(EDITOR);

    /*
     * Start from nothing published. A publication is durable by design — that is the point of the
     * table — so a run that stopped between publishing and withdrawing would otherwise leave the
     * next run asserting "there is nothing public yet" against last run's page.
     */
    if (
      await page
        .getByTestId("editorial-state")
        .textContent()
        .then((s) => s?.includes("pública desde"))
    ) {
      await page.getByLabel("Motivo de la retirada").fill("estado inicial de la prueba");
      await page.getByTestId("editorial-withdraw").click();
      await expect(page.getByTestId("editorial-ok")).toBeVisible({ timeout: 20_000 });
    }

    await page.getByTestId("editorial-profile-name").fill(FIRM);
    await page.getByTestId("editorial-profile-engagement").fill(ENGAGEMENT);
    await page.getByTestId("editorial-profile-save").click();
    await expect(page.getByTestId("editorial-ok")).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByTestId("editorial-profile-name")).toHaveValue(FIRM);
    await expect(page.getByTestId("editorial-profile-engagement")).toHaveValue(ENGAGEMENT);
  });

  test("B · un editor escribe, sube archivos y añade equipo", async ({ page }) => {
    await page.goto(EDITOR);
    const main = page.getByRole("main");

    await main.getByLabel("Titular").fill(HEADLINE);
    await main.getByLabel("Hallazgos").fill(SECTION_TEXT);

    // Start from an empty page. A draft is one per project and survives a run, so without this
    // the journey would be asserting about whatever the last run happened to leave behind.
    for (const id of ["editorial-remove-section", "editorial-remove-member"]) {
      const buttons = main.getByTestId(id);
      for (let remaining = await buttons.count(); remaining > 0; remaining -= 1) {
        await buttons.first().click();
      }
      await expect(buttons).toHaveCount(0);
    }

    // A section to hang the files on.
    await main.getByRole("button", { name: "Añadir sección" }).click();
    // The one just added, not the first on screen: a draft left behind by an earlier run of this
    // journey would otherwise decide which section the assertions are about.
    const section = main.getByTestId("editorial-section").last();
    await section.getByLabel("Título de la sección").fill("Biótico");
    await section.getByLabel("Texto", { exact: true }).fill(SECTION_TEXT);

    // A photograph that genuinely carries GPS, so the public check below means something.
    await section
      .getByLabel("Elegir archivo")
      .first()
      .setInputFiles({
        name: "equipo.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from(await buildJpegWithGps({ width: 400, height: 300 })),
      });
    await page.getByTestId("editorial-upload-photo").click();
    await expect(page.getByTestId("editorial-upload-ok").first()).toBeVisible({ timeout: 40_000 });
    // The input is cleared both ways: no ghost filename under a form that no longer holds one.
    await expect(section.getByLabel("Elegir archivo").first()).toHaveValue("");
    await section
      .getByLabel("Texto alternativo")
      .first()
      .fill("Vía de tierra vista desde el margen");

    await section
      .getByLabel("Elegir archivo")
      .nth(1)
      .setInputFiles({
        name: "anexo.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(buildPdf(["Anexo sintético de prueba. ".repeat(10)])),
      });
    await page.getByTestId("editorial-upload-document").click();
    await expect(page.getByTestId("editorial-upload-ok").nth(1)).toBeVisible({ timeout: 40_000 });

    await section
      .getByLabel("Elegir archivo")
      .nth(2)
      .setInputFiles({
        name: "presentacion.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: Buffer.from(buildPptx()),
      });
    await page.getByTestId("editorial-upload-slides").click();
    await expect(page.getByTestId("editorial-upload-ok").nth(2)).toBeVisible({ timeout: 40_000 });

    await page.getByTestId("editorial-add-member").click();
    const member = page.getByTestId("editorial-member").last();
    await member.getByLabel("Nombre", { exact: true }).fill(MEMBER);
    await member.getByLabel("Cargo profesional").fill("Especialista biótica");
    await member.getByLabel("Reseña / experiencia").fill("Reseña sintética de prueba.");

    await page.getByTestId("editorial-save").click();
    await expect(page.getByTestId("editorial-ok")).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByRole("main").getByLabel("Titular")).toHaveValue(HEADLINE);
    await expect(
      page.getByTestId("editorial-member").last().getByLabel("Nombre", { exact: true }),
    ).toHaveValue(MEMBER);
  });

  test("C · sin sesión, antes de publicar, no hay nada", async ({ browser }) => {
    const project = await visit(browser, PUBLIC_PROJECT);
    expect(project.status).toBe(404);
    await project.context.close();

    // The editor itself is not reachable either: a visitor is sent to sign in, never shown a draft.
    const editor = await visit(browser, EDITOR);
    expect(editor.page.url()).toContain("/sign-in");
    await expect(editor.page.getByRole("main")).not.toContainText(HEADLINE);
    await editor.context.close();
  });

  test("D · el publicador publica", async ({ page }) => {
    await page.goto(EDITOR);
    await page.getByTestId("editorial-publish").click();
    await expect(page.getByTestId("editorial-ok")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("editorial-state")).toContainText("pública desde");
  });

  test("F · editar el borrador no cambia lo publicado", async ({ page }) => {
    await page.goto(EDITOR);
    await page.getByRole("main").getByLabel("Titular").fill("Titular que NO debe publicarse");
    await page.getByTestId("editorial-save").click();
    await expect(page.getByTestId("editorial-ok")).toBeVisible({ timeout: 20_000 });
  });

  test("E · sin sesión, después de publicar, se ve lo publicado y sólo eso", async ({
    browser,
  }) => {
    const landing = await visit(browser, PUBLIC_TENANT);
    expect(landing.status).toBe(200);
    await expect(landing.page.getByRole("heading", { level: 1 })).toHaveText(FIRM);
    await expect(landing.page.getByRole("main")).toContainText(ENGAGEMENT);
    await expect(landing.page.getByRole("link", { name: HEADLINE })).toBeVisible();
    await landing.context.close();

    const project = await visit(browser, PUBLIC_PROJECT);
    expect(project.status).toBe(200);
    const main = project.page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(HEADLINE);
    await expect(main).toContainText(SECTION_TEXT);
    await expect(main).toContainText(MEMBER);

    // The photograph is served, and what is served is the derivative: its bytes carry no EXIF.
    const img = main.locator("img").first();
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("alt", /margen/);
    const src = await img.getAttribute("src");
    const photo = await project.page.request.get(src!);
    expect(photo.status()).toBe(200);
    const bytes = await photo.body();
    expect([...bytes.subarray(0, 3)]).toEqual(JPEG_SIGNATURE);
    expect(bytes.includes(Buffer.from("Exif\u0000\u0000", "ascii"))).toBe(false);

    // The PDF and the deck are offered as links, and both resolve.
    for (const name of ["anexo.pdf", "presentacion.pptx"]) {
      const link = main.getByRole("link", { name });
      await expect(link).toBeVisible();
      const response = await project.page.request.get((await link.getAttribute("href"))!);
      expect(response.status()).toBe(200);
    }

    // The draft edited in F is not what a visitor reads.
    await expect(main).not.toContainText("NO debe publicarse");
    await project.context.close();
  });

  test("H · el editor, la portada y la ficha pública son usables y accesibles", async ({
    browser,
    page,
  }) => {
    await page.goto(EDITOR);
    await expect(page.getByTestId("editorial-state")).toBeVisible();
    await scan(page, "el editor");
    await page.screenshot({ path: shot("01-editor"), fullPage: true });

    // Reachable by keyboard: the publish control is not a div somebody styled as a button.
    await page.getByRole("main").getByLabel("Titular").focus();
    const reached = await page.evaluate(() => {
      const focusables = [
        ...document.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
        ),
      ];
      return focusables.some((el) => el.dataset.testid === "editorial-publish");
    });
    expect(reached).toBe(true);

    const landing = await visit(browser, PUBLIC_TENANT);
    await scan(landing.page, "la portada");
    await landing.page.screenshot({ path: shot("02-portada"), fullPage: true });
    await assertNoHorizontalOverflow(landing.page, "la portada (escritorio)");
    await landing.page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(landing.page, "la portada (móvil)");
    await landing.context.close();

    const project = await visit(browser, PUBLIC_PROJECT);
    await scan(project.page, "la ficha pública");
    await project.page.screenshot({ path: shot("03-ficha-publica"), fullPage: true });
    await assertNoHorizontalOverflow(project.page, "la ficha pública (escritorio)");
    await project.page.setViewportSize({ width: 390, height: 844 });
    await expect(project.page.getByRole("heading", { level: 1 })).toBeVisible();
    await assertNoHorizontalOverflow(project.page, "la ficha pública (móvil)");
    await project.context.close();
  });

  test("I · la ruta pública de archivos no es un directorio del bucket", async ({
    browser,
    page,
  }) => {
    const project = await visit(browser, PUBLIC_PROJECT);

    // An id nobody published. Not 403, not an empty body with a 200: the route answers the same
    // way for "no such object" and "an object you may not have", so it cannot be enumerated.
    const invented = await project.page.request.get(
      `${PUBLIC_PROJECT}/media/00000000-0000-7000-8000-000000000000`,
    );
    expect(invented.status()).toBe(404);

    // A real, currently-public asset, asked for under a tenant and a project it does not belong
    // to. The authorisation is the publication's asset row, not the namespace the object sits in.
    const href = await project.page.getByRole("main").locator("img").first().getAttribute("src");
    const objectId = href!.split("/").pop()!;
    for (const path of [
      `/p/${TENANT}/no-such-project/media/${objectId}`,
      `/p/no-such-tenant/${PROJECT}/media/${objectId}`,
    ]) {
      const response = await project.page.request.get(path);
      expect(response.status(), path).toBe(404);
    }
    await project.context.close();

    // And the editor is not reachable by someone who is merely signed in elsewhere: the route is
    // behind the project's own permission, not behind knowing the URL.
    const foreign = await visit(browser, `/t/${TENANT}/p/no-such-project/portal/editorial`);
    expect(foreign.page.url()).toContain("/sign-in");
    await foreign.context.close();

    /*
     * A signed-in editor asking for a project that is not theirs gets the product's documented
     * non-enumeration answer (SECURITY.md §3): the same `permission denied` state a project they
     * simply cannot see would produce, and no editorial content at all. It is deliberately *not*
     * a 404 here — that is ADR-016's answer for a **disabled capability**, and conflating the two
     * would make this surface disagree with every other workspace route.
     */
    await page.goto(`/t/${TENANT}/p/no-such-project/portal/editorial`);
    await expect(page.getByRole("main")).toContainText("No tienes acceso");
    await expect(page.getByTestId("editorial-publish")).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText(HEADLINE);
  });

  test("G · retirar la quita de la ficha, de la portada y de sus archivos", async ({
    browser,
    page,
  }) => {
    const before = await visit(browser, PUBLIC_PROJECT);
    const assetHref = await before.page
      .getByRole("main")
      .locator("img")
      .first()
      .getAttribute("src");
    await before.context.close();

    await page.goto(EDITOR);
    await page.getByLabel("Motivo de la retirada").fill("prueba sintética de retirada");
    await page.getByTestId("editorial-withdraw").click();
    await expect(page.getByTestId("editorial-ok")).toBeVisible({ timeout: 20_000 });

    const project = await visit(browser, PUBLIC_PROJECT);
    expect(project.status).toBe(404);
    const asset = await project.page.request.get(assetHref!);
    expect(asset.status()).toBe(404);
    await project.context.close();

    const landing = await visit(browser, PUBLIC_TENANT);
    // The firm had one published road; with it withdrawn there is nothing public at all, and a
    // landing with nothing on it is the same answer as a tenant that does not exist.
    expect(landing.status).toBe(404);
    await landing.context.close();
  });
});
