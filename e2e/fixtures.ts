import { expect, test, type Page } from "@playwright/test";

/**
 * Synthetic identities provisioned by `pnpm e2e:prepare`. Passwords come from the environment so
 * nothing is committed; the addresses are on a reserved invalid domain so these accounts can
 * never collide with a real one.
 */
export const TENANT = "demo-consultancy";
export const PROJECT = "puente-del-amor";

/**
 * Parcel codes from the real cartographic package (ADR-023), not invented ones.
 *
 * `first` and `a` carry field work: the demonstration campaign takes every *n*-th parcel in
 * chainage order, so its assignments run the length of the corridor rather than clustering at
 * abscissa 0. `b` is a neighbour used only to prove that selecting a second row moves the map.
 * `noFieldWork` is a real parcel the campaign never reaches, and `absent` is a code the package
 * does not contain. They are three digits because that is what the consultancy's own field sheet
 * says — see `fixtures/projects/zamora-puente-del-amor/gis/parcels.geojson`.
 */
export const PARCELS = {
  a: "013",
  b: "005",
  first: "001",
  noFieldWork: "141",
  absent: "999",
} as const;

/**
 * What a parcel code from this package looks like: three digits, optionally with a letter suffix
 * for a subdivision (`032A`, and — a real defect the Quality Gate reports — `042a` beside `042A`).
 * Specs that need *some* parcel rather than a named one match on this.
 *
 * Anchored at the start but not the end, because it is matched against whole elements as well as
 * bare cells: an assignment card's text begins with the code and continues with its state. The
 * negative lookahead keeps it from matching the first three digits of a longer number.
 */
/**
 * The envelope of the study's own parcel layer, `[west, south, east, north]` in EPSG:4326.
 *
 * Measured from the delivered cartography with `ST_Extent` over the 141 active geometries, and
 * used to assert that the map's opening camera actually **contains all of them** — the claim a
 * count of rendered polygons cannot make, because a renderer may cull and a viewport may clip.
 */
export const PARCEL_EXTENT = {
  west: -78.74472,
  south: -3.81973,
  east: -78.70651,
  north: -3.77014,
} as const;

export const PARCEL_CODE_PATTERN = /^\d{3}[A-Za-z]?(?!\d)/;

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
  // Social Intelligence has a persona of its own: only a SOCIAL_SPECIALIST (and a REVIEWER)
  // settles a coding, and only a specialist starts a model run. A coordinator can watch the
  // workflow and read the analytics, which is a different screen and a different assertion.
  specialist: {
    email: "especialista@demo.invalid",
    name: "Especialista social",
    state: "e2e/.auth/specialist.json",
  },
  // The Quality Gate splits checking from deciding: a specialist runs the rules, a reviewer
  // settles what a finding means. Two identities, because one of the things worth asserting is
  // that the specialist *cannot* decide.
  reviewer: {
    email: "revisor@demo.invalid",
    name: "Revisora de calidad",
    state: "e2e/.auth/reviewer.json",
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
