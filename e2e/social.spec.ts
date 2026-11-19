import {
  expect,
  PROJECT,
  SEEDED_OPEN_TEXTS,
  TECHNICIAN_CONCERN_TEXT,
  TENANT,
  test,
} from "./fixtures";
import { drainClassificationQueue } from "./social-worker";

/**
 * Social Intelligence, in a browser, as the specialist who actually does this work.
 *
 * The journey the slice exists for: deterministic tabulation → open responses → a model's
 * proposal → a human decision → validated themes. What the assertions watch for is the boundary
 * between those, because that is the thing a screen can quietly erase: a proposal must be visible
 * as provisional, a validated coding must be attributed to a person, and the two must never share
 * a denominator.
 *
 * No live model is involved: the queue is drained by `pnpm social:drain` with the deterministic
 * fake (`social-worker.ts`), which is also what CI does.
 */
const SOCIAL = `/t/${TENANT}/p/${PROJECT}/social`;

test.describe.configure({ mode: "serial" });

test.describe("Social Intelligence · the specialist's journey", () => {
  test("deterministic tabulation states its denominators and its source", async ({ page }) => {
    await page.goto(SOCIAL);
    const main = page.getByRole("main");

    await expect(main).toContainText("Tabulación de preguntas cerradas");
    await expect(main).toContainText("Cálculo determinista · sin modelo de lenguaje");
    // The denominator is on screen, in words, for every question.
    await expect(main).toContainText("sobre quienes respondieron la pregunta");
    await expect(main).toContainText("sin responder");
    // Multi-choice says plainly that its shares can exceed 100 %.
    await expect(main).toContainText("puede superar el 100 %");
    // …and the version, because versions are never added together.
    await expect(main).toContainText("versión");
  });

  test("the counts on the page add up", async ({ page }) => {
    await page.goto(SOCIAL);
    const text = (await page.getByRole("main").innerText()).replace(/\u00a0/g, " ");

    // The property, not a fixed total: the universe is stated, and for every question
    // answered + unanswered equals it. A total is not asserted because the field suite
    // legitimately submits more responses when it runs first, and a test that broke on that would
    // be measuring the order of the suite rather than the arithmetic.
    const submitted = Number(/(\d+) respuestas enviadas/.exec(text)?.[1]);
    expect(submitted).toBeGreaterThan(0);

    const pairs = [...text.matchAll(/(\d+) respondieron · (\d+) sin responder/g)];
    expect(pairs.length).toBeGreaterThan(0);
    for (const [, answered, unanswered] of pairs) {
      expect(Number(answered) + Number(unanswered)).toBe(submitted);
    }
  });

  test("the open-response queue shows submitted text and nothing about the person", async ({
    page,
  }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    const main = page.getByRole("main");

    await expect(main).toContainText("Respuestas abiertas");

    /*
     * Every row carries the words somebody wrote, verbatim.
     *
     * Asserted against the set of texts this project has submitted rather than against one of
     * them, because *which* of them is on screen depends on which **generation** of a response the
     * analysis currently means. A correction never edits a submitted response: it is a new
     * capture, and Social — correctly — reads `app.effective_survey_instance` (ADR-038). This spec
     * used to name one seeded phrase, which made it pass only against a database no correction had
     * ever touched, and fail on the second run of the suite for a reason that is about the suite's
     * history rather than about the product.
     *
     * Set membership keeps the claim exact: a truncation, a pseudonym, an identifier, an empty row
     * or one response's text rendered in another's place is still a failure.
     */
    const known: ReadonlyArray<string> = [...SEEDED_OPEN_TEXTS, TECHNICIAN_CONCERN_TEXT];
    // One <article> per open response, and the only one anywhere in the product.
    const rows = main.getByRole("article");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    for (let index = 0; index < rowCount; index += 1) {
      const text = (await rows.nth(index).locator(":scope > p").first().innerText()).trim();
      expect(
        known,
        `the queue shows open text this suite does not know: ${JSON.stringify(text)}. ` +
          "If a spec now submits it, add it to e2e/fixtures.ts.",
      ).toContain(text);
    }

    /*
     * And what it lists is the effective responses, not every generation ever captured. The figure
     * above the list is counted by one query and the list is built by another, both over
     * `app.effective_survey_instance`; a disagreement between them is what a superseded capture
     * leaking back into the analysis would look like.
     */
    // `textContent`, not `innerText`: the labels are uppercased by CSS, and Chromium's `innerText`
    // returns the text as rendered — so a case-sensitive match against the product's own wording
    // finds nothing there.
    const shown = ((await main.textContent()) ?? "").replace(/\u00a0/g, " ");
    const counts = [...shown.matchAll(/Respuestas abiertas\s*(\d+)/g)].map((match) =>
      Number(match[1]),
    );
    expect(counts.length).toBeGreaterThan(0);
    for (const value of counts) expect(value).toBe(rowCount);

    // No respondent, no technician, no parcel code, no coordinate on this screen.
    await expect(main).not.toContainText("Técnico de campo");
    // No parcel code in the coding queue: a coding is about what someone said, not about where
    // they live. The codes are three digits now, so the assertion checks the column that would
    // carry one rather than a prefix that no longer exists.
    await expect(main.getByRole("columnheader", { name: /Predio/ })).toHaveCount(0);
    await expect(main).not.toContainText("-78.9");
  });

  test("a run is created, the worker completes it, and proposals arrive as provisional", async ({
    page,
  }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    const main = page.getByRole("main");

    await expect(main).toContainText("Esquema de codificación");
    await expect(main).toContainText("DEMO / RECONSTRUIDA");

    await page.getByRole("button", { name: "Ejecutar codificación asistida" }).click();
    await expect(main).toContainText(/Ejecución creada/);

    // The worker: the same use-cases a background process runs, with the deterministic fake.
    const output = drainClassificationQueue();
    expect(output).toMatch(/processed with the fake classifier/);

    await page.reload();
    await expect(main).toContainText("Propuesta de la IA");
    await expect(main).toContainText("provisional, sin validar");
    await expect(main).toContainText("Confianza del modelo");
    // The run's configuration is on screen: which model, which adapter, which prompt, which scheme.
    await expect(main).toContainText("fake/deterministic");
    await expect(main).toContainText("social-open-coding@1");
  });

  test("the low-confidence state is shown as a review aid, never as an accuracy", async ({
    page,
  }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    const main = page.getByRole("main");

    await page.getByRole("button", { name: "Confianza baja" }).click();
    await expect(main).toContainText("revisar primero");
    await expect(main).toContainText("El modelo pidió revisión humana");

    // The wording rule, asserted on the rendered page. Both denials are visible text rather than
    // tooltips, so a screen reader reaches them: the number is not a calibrated probability, and
    // the agreement figure is not the model's accuracy. (The forbidden phrasings themselves are
    // enforced repository-wide by the product-language linter.)
    await expect(main).toContainText(/no es una probabilidad calibrada/i);
    await expect(main).toContainText(/concordancia operativa, no acierto del modelo/i);
  });

  test("the specialist accepts one proposal and corrects another", async ({ page }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    const main = page.getByRole("main");

    // Accept: open the first pending review and submit the proposal unchanged.
    await page.getByRole("button", { name: "Revisar y decidir" }).first().click();
    await expect(main).toContainText("Categorías de esta versión");
    await page.getByRole("button", { name: "Aceptar propuesta" }).click();
    await expect(main).toContainText("Codificación validada por especialista");
    await expect(main).toContainText("Aceptada");

    // Correct: change the labels on the next one, which turns the button into a correction.
    await page.getByRole("button", { name: "Revisar y decidir" }).first().click();
    await page.getByRole("checkbox", { name: /Comunicación e información/ }).check();
    await page.getByRole("checkbox", { name: /Apoyo al proyecto/ }).uncheck();
    await page.getByRole("button", { name: "Guardar corrección" }).click();
    await expect(main).toContainText("Corregida");
  });

  test("validated themes count human labels, and the AI distribution stays separate", async ({
    page,
  }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    const main = page.getByRole("main");

    await expect(main).toContainText("Temas validados");
    await expect(main).toContainText("Solo cuenta lo que un especialista decidió");
    await expect(main).toContainText("sin revisar quedan fuera y no se extrapolan");

    // The provisional distribution exists and is labelled as such, in its own panel.
    await expect(main).toContainText("Distribución provisional de la IA");
    await expect(main).toContainText("Provisional · sin validar");

    // Agreement, named as agreement.
    await expect(main).toContainText("Coincidencia IA · especialista");
    await expect(main).toContainText("Corregidas por el especialista");
    await expect(main).toContainText(/concordancia operativa, no acierto del modelo/);
  });

  test("the proposal survives the correction, in the traceability the screen shows", async ({
    page,
  }) => {
    await page.goto(`${SOCIAL}?tab=abiertas`);
    const main = page.getByRole("main");
    await page.getByRole("button", { name: "Revisadas" }).click();

    // Both are on screen at once for a reviewed response: what the model said, and what the
    // specialist decided. The correction did not overwrite the proposal.
    await expect(main).toContainText("Propuesta de la IA");
    await expect(main).toContainText("Codificación validada por especialista");
  });

  test("the historical study and the demo coding stay apart", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    // The concluded study's socioeconomic figures carry the historical badge on the Command
    // Center: they are historical observations, and nothing produced by this slice joins them.
    await expect(page.getByRole("main")).toContainText("Dato histórico");

    // Everything on the Social surface is demonstration data, and says so: the coding scheme is
    // marked as a reconstruction and the responses are synthetic.
    await page.goto(`${SOCIAL}?tab=abiertas`);
    const social = page.getByRole("main");
    await expect(social).toContainText("DEMO / RECONSTRUIDA");
    await expect(social).not.toContainText("Dato histórico");
  });
});
