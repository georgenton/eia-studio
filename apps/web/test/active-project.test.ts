import { describe, expect, it } from "vitest";

import { chooseActiveProjectSlug } from "../lib/active-project";

/**
 * The rail's choice of project, which is an authorization-shaped decision wearing navigation
 * clothes. Every one of these cases was observed on staging before it was written down: a
 * coordinator who administers the firm opened the Portfolio, clicked the first module in the
 * rail, and was refused — because the rail had quietly decided the oldest study of the firm was
 * their active project.
 */
describe("chooseActiveProjectSlug", () => {
  const puenteDelAmor = { slug: "puente-del-amor", accessible: false };
  const bramadora = { slug: "capacitacion-bramadora-la-alegria", accessible: true };

  it("prefers a project the caller can open over the first of the list", () => {
    expect(chooseActiveProjectSlug(null, [puenteDelAmor, bramadora])).toBe(bramadora.slug);
  });

  it("the project named in the URL always wins: it was verified for this request", () => {
    expect(chooseActiveProjectSlug(puenteDelAmor.slug, [puenteDelAmor, bramadora])).toBe(
      puenteDelAmor.slug,
    );
  });

  it("keeps the order of the list among the projects the caller can open", () => {
    const first = { slug: "first-open", accessible: true };
    expect(chooseActiveProjectSlug(null, [puenteDelAmor, first, bramadora])).toBe(first.slug);
  });

  it("a caller who can open none still gets a rail, pointed at a refusal they can read", () => {
    expect(chooseActiveProjectSlug(null, [puenteDelAmor])).toBe(puenteDelAmor.slug);
  });

  it("no projects at all is no active project, not a crash", () => {
    expect(chooseActiveProjectSlug(null, [])).toBeNull();
    expect(chooseActiveProjectSlug(undefined, [])).toBeNull();
  });
});
