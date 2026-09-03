import { PROJECT, TENANT, expect, test } from "./fixtures";

/** Golden references for the slice report; regenerated whenever the surface changes. */
const DOCUMENTS = `/t/${TENANT}/p/${PROJECT}/documents`;
const shot = (name: string) => `docs/screenshots/slice-6/${name}.png`;

test.describe("Slice 6 screenshots", () => {
  test("the corpus and the assistant", async ({ page }) => {
    await page.goto(DOCUMENTS);
    await page.getByRole("link", { name: "DOC-001" }).waitFor();
    await page.screenshot({ path: shot("01-documents"), fullPage: true });
  });

  test("an answer, cited", async ({ page }) => {
    await page.goto(DOCUMENTS);
    await page.getByLabel("Pregunta al expediente").fill("predios con afectación");
    await page.getByRole("button", { name: "Consultar" }).click();
    await expect(page.getByTestId("assistant-answer")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: shot("02-assistant-cited"), fullPage: true });
  });

  test("a document's passages", async ({ page }) => {
    await page.goto(`${DOCUMENTS}/DOC-002`);
    await page.getByText("Pasaje 1").waitFor();
    await page.screenshot({ path: shot("03-document-passages"), fullPage: true });
  });
});
