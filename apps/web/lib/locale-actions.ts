"use server";

import { isLocale, type Locale } from "@eia/i18n";
import { cookies } from "next/headers";

import { LOCALE_COOKIE } from "@/lib/locale";

/**
 * Remember which language this browser reads the product in.
 *
 * A preference, not a credential: no `httpOnly` (nothing reads it that a script may not), one
 * year, `sameSite: lax` so it survives ordinary navigation, and `secure` wherever the site is.
 * An unrecognised value is ignored rather than stored — the cookie is read back into a typed
 * locale, and writing something else would just be a slower way of getting the default.
 */
export async function setLocaleAction(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
