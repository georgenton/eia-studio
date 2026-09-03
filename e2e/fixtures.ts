import { expect, test, type Page } from "@playwright/test";

/**
 * Synthetic identities provisioned by `pnpm e2e:prepare`. Passwords come from the environment so
 * nothing is committed; the addresses are on a reserved invalid domain so these accounts can
 * never collide with a real one.
 */
export const TENANT = "demo-consultancy";
export const PROJECT = "puente-del-amor";

export const USERS = {
  coordinator: {
    email: "coordinadora@demo.invalid",
    name: "Coordinadora de proyecto",
    state: "e2e/.auth/coordinator.json",
  },
  admin: {
    email: "admin@demo.invalid",
    name: "Administradora del tenant",
    state: "e2e/.auth/admin.json",
  },
  technician: {
    email: "tecnico@demo.invalid",
    name: "Técnico de campo 1",
    state: "e2e/.auth/technician.json",
  },
  technicianTwo: {
    email: "tecnico2@demo.invalid",
    name: "Técnico de campo 2",
    state: "e2e/.auth/technician2.json",
  },
} as const;

/**
 * A synthetic point on the reconstructed corridor, matching the demo fixture. It is not, and must
 * never be, anybody's home: it exists so the geolocation path can be exercised without a real
 * coordinate ever entering a test, a screenshot or a database.
 */
export const SYNTHETIC_LOCATION = { longitude: -78.9412, latitude: -4.0761 } as const;

export function password(): string {
  const value = process.env.DEMO_USER_PASSWORD;
  if (!value) throw new Error("DEMO_USER_PASSWORD must be set to run the e2e suite");
  return value;
}

/**
 * Sign in through the real form. Called once per role by the setup project: the identity layer
 * rate-limits sign-in attempts, and re-authenticating in every test is both slower and a worse
 * simulation of a session.
 */
export async function signIn(page: Page, user: { email: string }): Promise<void> {
  // Bounded retry, because the identity layer rate-limits sign-in attempts and the setup project
  // authenticates four roles back to back. The retry is for the throttle, not for a wrong
  // password: a genuinely bad credential fails all three attempts and the assertion still fires.
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await page.goto("/sign-in");
    await page.getByLabel("Correo institucional").fill(user.email);
    await page.getByLabel("Contraseña").fill(password());
    await page.getByRole("button", { name: "Entrar" }).click();
    try {
      await expect(page).toHaveURL(/\/(t\/|$)/, { timeout: 8_000 });
      // The form renders its own error in an alert; Next's route announcer also uses that role,
      // so the check is scoped to the sign-in surface.
      await expect(page.locator('main [role="alert"]')).toHaveCount(0);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await page.waitForTimeout(3_000 * attempt);
    }
  }
}

export { expect, test };
