import { describe, expect, it, vi } from "vitest";

import { DEFAULT_LOCALE } from "@eia/i18n";

/**
 * Which language the workspace answers in.
 *
 * ADR-029 is explicit: the reader's choice is a cookie, and the default is `es-EC`, because *a
 * consultant whose browser is configured in English did not ask for an English product*. The
 * resolver used to consult `Accept-Language` between the two, which produced exactly the outcome
 * that sentence forbids — and would have shown an English product to a Spanish-language training
 * session held on borrowed laptops.
 *
 * These cases pin the order so the header cannot creep back in.
 */
vi.mock("server-only", () => ({}));

const cookieStore = { value: undefined as string | undefined };
const headerReads: string[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "eia.locale" && cookieStore.value !== undefined
        ? { name, value: cookieStore.value }
        : undefined,
  }),
  headers: async () => ({
    get: (name: string) => {
      headerReads.push(name);
      return "en-US,en;q=0.9";
    },
  }),
}));

const { getLocale } = await import("../lib/locale");

describe("getLocale", () => {
  it("answers in Spanish when nobody has chosen", async () => {
    cookieStore.value = undefined;
    expect(await getLocale()).toBe(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe("es-EC");
  });

  it("stays in Spanish even when the browser advertises English", async () => {
    cookieStore.value = undefined;
    headerReads.length = 0;
    expect(await getLocale()).toBe("es-EC");
    // Not merely outranked: never read. A header that is never consulted cannot regress.
    expect(headerReads).toEqual([]);
  });

  it("honours an explicit choice of English", async () => {
    cookieStore.value = "en";
    expect(await getLocale()).toBe("en");
  });

  it("honours an explicit choice of Spanish", async () => {
    cookieStore.value = "es-EC";
    expect(await getLocale()).toBe("es-EC");
  });

  it("falls back to Spanish when the cookie holds something that is not a locale", async () => {
    cookieStore.value = "klingon";
    expect(await getLocale()).toBe("es-EC");
  });
});
