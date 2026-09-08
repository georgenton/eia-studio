import { expect, PROJECT, TENANT, test } from "./fixtures";
import { CLIENT_VIEW, ensurePublication, PORTAL } from "./portal-runner";

/**
 * The client portal, end to end: the consulting team prepares and publishes, and the client's page
 * shows what was published — and nothing else.
 *
 * The assertions that matter here are negative ones. A screen that looks right and quietly carries
 * a household's answer, a technician's name or an unresolved internal disagreement is the failure
 * this whole surface exists to prevent, so the spec reads the rendered page and checks that those
 * things are not on it.
 */
test.describe.configure({ mode: "serial" });

/**
 * The internal vocabulary a client must never meet, and the two figures of the open discrepancy.
 *
 * `70`/`71` are checked as whole words against the rendered text: the corpus states both for the
 * affected-parcel count, the Quality Gate is holding it open, and a publication that picked one
 * would settle it by accident in the firm's name.
 */
const FORBIDDEN_ON_CLIENT_PAGE = [
  "DEMO_SIMULATION",
  "HISTORICAL_OBSERVED",
  "LIVE_OPERATIONAL",
  "provenance",
  "procedencia",
  "hallazgo",
  "human_review",
  "aiClassification",
  "confianza",
  "predio 0",
  "técnico",
  "encuestado",
  "borrador",
];

test.describe("Portal del cliente · the consulting team", () => {
  test("the surface says what a publication is before there is one", async ({ page }) => {
    await page.goto(PORTAL);
    const main = page.getByRole("main");
    await expect(main).toContainText("El portal es una publicación");
    await expect(main).toContainText("Preparar actualización");
    await expect(main).toContainText("Historial de publicaciones");
  });

  test("the draft names the figures it will publish and the ones it will not", async ({ page }) => {
    await page.goto(PORTAL);
    const main = page.getByRole("main");
    await expect(main).toContainText("Predios frentistas");
    await expect(main).toContainText("Fichas socioeconómicas");
    await expect(main).toContainText("Participantes en asambleas");

    // The two deliberate omissions, named on screen so nobody has to wonder where they went.
    await expect(main).toContainText("No se publica");
    await expect(main).toContainText("Predios con afectación");
    await expect(main).toContainText("Avance del levantamiento en curso");
  });

  test("publishing adds a version and never edits the previous one", async ({ page }) => {
    // Counted rather than named: publications accumulate across runs against the same database,
    // and the property under test is "one more, none lost" rather than any particular label.
    await page.goto(PORTAL);
    const rows = page.getByRole("cell", { name: /^v\d+$/ });
    const before = await rows.count();

    await page.getByRole("button", { name: /Publicar/ }).click();
    await expect(page.getByRole("status")).toContainText("Publicada", { timeout: 30_000 });
    await expect(rows).toHaveCount(before + 1);
    // v1 is still there, whatever number the newest one carries.
    await expect(page.getByRole("cell", { name: "v1", exact: true })).toBeVisible();
  });
});

test.describe("Vista del cliente · what the customer sees", () => {
  test.beforeEach(async ({ page }) => {
    await ensurePublication(page);
  });

  test("is a standalone page: no rail, no operational navigation", async ({ page }) => {
    await page.goto(CLIENT_VIEW);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Puente del Amor");
    // The internal shell's rail and its surfaces are absent, not hidden.
    await expect(page.getByRole("link", { name: "Cartografía y predios" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Control de consistencia" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Trabajo de campo" })).toHaveCount(0);
    await expect(page.getByText("Cartera de proyectos")).toHaveCount(0);
  });

  test("says when it was published, and that the link is not yet shared", async ({ page }) => {
    await page.goto(CLIENT_VIEW);
    await expect(page.getByText("Última actualización publicada")).toBeVisible();
    // The preview notice is outside the client content, discreet, and true.
    await expect(page.getByText("este enlace aún no está compartido con el cliente")).toBeVisible();
  });

  test("shows the executive figures the study actually established", async ({ page }) => {
    await page.goto(CLIENT_VIEW);
    const main = page.getByRole("main");
    await expect(main).toContainText("Resumen del estudio");
    await expect(main).toContainText("Predios frentistas");
    await expect(main).toContainText("141");
    await expect(main).toContainText("Participación y componente social");
    await expect(main).toContainText("119");
    await expect(main).toContainText("185");
  });

  test("shows the management plan as a shape, not as a table of measures", async ({ page }) => {
    await page.goto(CLIENT_VIEW);
    const main = page.getByRole("main");
    await expect(main).toContainText("Plan de Manejo Ambiental");
    await expect(main).toContainText("Planes");
    await expect(main).toContainText("Programas");
    await expect(main).toContainText("Medidas");
    await expect(main).toContainText("PLAN DE RELACIONES COMUNITARIAS");
    // The measures' own text is a deliverable, not a summary figure.
    await expect(main).not.toContainText("mantenimiento preventivo y correctivo");
  });

  test("draws the corridor and the delimited areas, and no parcels", async ({ page }) => {
    await page.goto(CLIENT_VIEW);
    const map = page.locator("[data-map-idle='true']");
    await expect(map).toBeVisible({ timeout: 20_000 });
    // "The component rendered" is not the same claim as "the corridor is on screen": the map
    // publishes what its camera can actually see, and the assertion reads that.
    expect(Number(await map.getAttribute("data-alignment-in-view"))).toBeGreaterThan(0);
    expect(Number(await map.getAttribute("data-areas-in-view"))).toBeGreaterThan(0);

    // The map's accessible description names what is drawn; parcels are not among them.
    await expect(page.getByText(/Trazado:/)).toBeVisible();
    const described = (await page.getByText(/Trazado:/).textContent()) ?? "";
    expect(described.toLowerCase()).not.toContain("predio");
  });

  test("is honest about what has not been published", async ({ page }) => {
    await page.goto(CLIENT_VIEW);
    const main = page.getByRole("main");
    await expect(main).toContainText("No se ha publicado todavía información de avance operativo.");
    await expect(main).toContainText("No hay entregables publicados");
  });

  /**
   * The denylist, against the rendered surface.
   *
   * The structural guarantee is the payload schema, asserted in the domain and integration suites.
   * This is the end-to-end one: whatever the components do with the payload, these words and these
   * two numbers do not reach a client's screen.
   */
  test("carries no internal record, no internal vocabulary and no unresolved figure", async ({
    page,
  }) => {
    await page.goto(CLIENT_VIEW);
    const body = ((await page.getByRole("main").textContent()) ?? "").toLowerCase();
    for (const forbidden of FORBIDDEN_ON_CLIENT_PAGE) {
      expect(body, forbidden).not.toContain(forbidden.toLowerCase());
    }
    // The affected-parcel discrepancy: neither figure, as a standalone number.
    expect(body).not.toMatch(/(^|[^\d,.])70([^\d,.]|$)/);
    expect(body).not.toMatch(/(^|[^\d,.])71([^\d,.]|$)/);
  });

  test("an internal reviewer can open an earlier publication deliberately", async ({ page }) => {
    await page.goto(PORTAL);
    const rows = await page.getByRole("cell", { name: /^v\d+$/ }).count();
    test.skip(rows < 2, "needs two publications");
    await page.goto(`${CLIENT_VIEW}?v=1`);
    await expect(page.getByText(/Estás viendo una publicación anterior/)).toBeVisible();
  });

  test("offers a printable summary", async ({ page }) => {
    await page.goto(CLIENT_VIEW);
    await expect(page.getByRole("button", { name: "Imprimir resumen" })).toBeVisible();
    // The print stylesheet drops the preview strip; the client content stays.
    await page.emulateMedia({ media: "print" });
    await expect(page.getByText("este enlace aún no está compartido")).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Resumen del estudio");
    await page.emulateMedia({ media: "screen" });
  });
});

test.describe("who may reach the client view", () => {
  test("a project with no portal answers 404, like a route that means nothing", async ({
    page,
  }) => {
    const response = await page.goto(`/portal/${TENANT}/no-such-project`);
    expect(response?.status()).toBe(404);
  });

  test("the internal surface is reached from the rail", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    await page.getByRole("link", { name: "Portal del cliente" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${TENANT}/p/${PROJECT}/portal$`));
  });
});
