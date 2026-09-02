import { expect, password, PROJECT, TENANT, test, USERS } from "./fixtures";

test.describe("unauthenticated access", () => {
  test("a workspace route sends the visitor to sign in", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("the sign-in surface offers no registration", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await expect(page.getByText("El registro público está deshabilitado")).toBeVisible();
    await expect(page.getByRole("link", { name: /crear cuenta|registrarse/i })).toHaveCount(0);
  });
});

/**
 * Regression: credentials must never reach a URL (IG2-006).
 *
 * The defect this closes: the sign-in `<form>` declared no `method`, so a submit that happened
 * before hydration fell back to the browser's default — a **GET** — which put the password in the
 * address bar, in `history`, and in the `Referer` of everything the next page loaded. It was
 * invisible in normal use, because a hydrated page never takes that path.
 *
 * The password used here is a disposable synthetic value from the environment; it is compared
 * against, never printed. A failure reports which URL leaked, not what was in it.
 */
test.describe("credentials never appear in a URL", () => {
  /** Fails without revealing the secret, whichever way the assertion goes. */
  const expectNoSecret = (haystack: string, secret: string, where: string) => {
    expect(
      haystack.includes(secret) || haystack.includes(encodeURIComponent(secret)),
      `${where} contained the password`,
    ).toBe(false);
  };

  test("the form declares POST, so a submit before hydration has no GET fallback to take", async ({
    page,
  }) => {
    // This attribute *is* the fix. Without it the browser default is GET, and a click that lands
    // before React has attached its handler serialises the password into the query string.
    await page.goto("/sign-in");
    const form = page.locator("form").first();
    await expect(form).toBeVisible();
    expect((await form.getAttribute("method"))?.toLowerCase()).toBe("post");
  });

  test("with scripts disabled the page serves no credential form at all", async ({ browser }) => {
    // The strongest form of "before hydration". The form is inside a Suspense boundary, so
    // without scripts it never renders and there is nothing to submit natively — belt as well as
    // the braces of `method="post"`. Asserted so that a future change which starts serving the
    // form in the static HTML has to come past this test and think about the method again.
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/sign-in");
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await context.close();
  });

  test("the identity endpoint refuses credentials sent as a query string", async ({ request }) => {
    // Even if a URL with credentials were somehow constructed, the endpoint must not honour it.
    const response = await request.get(
      `/api/auth/sign-in/email?email=${encodeURIComponent(USERS.coordinator.email)}` +
        `&password=${encodeURIComponent(password())}`,
      { failOnStatusCode: false },
    );
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.headers()["set-cookie"] ?? "").not.toMatch(/session/i);
  });

  test("the hydrated path leaves no credential in the URL or in history", async ({ page }) => {
    const secret = password();
    const seen: string[] = [];
    page.on("request", (request) => seen.push(request.url()));

    // The form is submitted for real, but the assertion is about URLs, not about the outcome:
    // whether the identity layer accepts, rejects or rate-limits this attempt, the password must
    // not appear in any of them. Deliberately not `signIn()`, which also asserts success and
    // would make this security check fail for an unrelated reason.
    await page.goto("/sign-in");
    await page.getByLabel("Correo institucional").fill(USERS.coordinator.email);
    await page.getByLabel("Contraseña").fill(secret);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForLoadState("networkidle");

    expectNoSecret(page.url(), secret, "the address bar");
    for (const url of seen) expectNoSecret(url, secret, "a request URL");

    // Everything the session can still navigate back to.
    const entries = await page.evaluate(() =>
      performance.getEntriesByType("navigation").map((entry) => entry.name),
    );
    for (const entry of entries) expectNoSecret(entry, secret, "a history entry");
    const history = await page.evaluate(() => ({
      href: window.location.href,
      search: window.location.search,
    }));
    expectNoSecret(history.href, secret, "window.location.href");
    expectNoSecret(history.search, secret, "window.location.search");
  });
});
