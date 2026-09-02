import { signIn, test as setup, USERS } from "./fixtures";

/**
 * Authenticate once per role and store the session. Every spec then starts already signed in,
 * which keeps the suite fast and stays inside the identity layer's sign-in rate limit.
 */
setup("authenticate as the project coordinator", async ({ page }) => {
  await signIn(page, USERS.coordinator);
  await page.context().storageState({ path: USERS.coordinator.state });
});

setup("authenticate as the tenant administrator", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.context().storageState({ path: USERS.admin.state });
});
