import "server-only";

import {
  DEFAULT_LOCALE,
  createFormat,
  createTranslator,
  isLocale,
  type Format,
  type Locale,
  type Translator,
} from "@eia/i18n";
import { cookies } from "next/headers";

/**
 * Which language this request is answered in.
 *
 * ## Why a cookie and not an account setting
 *
 * Better Auth owns identity, authentication and sessions, and nothing else (ADR-010). Adding a
 * profile column so a language could follow a person between devices would put a product
 * preference inside the identity system, which is the boundary that ADR exists to hold. A cookie
 * is a per-browser preference, which is what this is; when an account-level preference is wanted it
 * becomes a row EIA Studio owns, and this function reads it first without anything else changing.
 *
 * ## The order, and why
 *
 * **The cookie, then the default. The browser's `Accept-Language` is not consulted.**
 *
 * It used to sit between the two, and that was the wrong shape for the reason this file already
 * stated and then contradicted: *a Spanish-speaking consultant whose browser is configured in
 * English did not ask for an English product.* With the header in the chain, that consultant got
 * English — which is what ADR-029 says must not happen, and what a room full of borrowed laptops
 * would have shown during a Spanish-language training session.
 *
 * `Accept-Language` is a statement about the operating system a browser was installed under. The
 * language this product answers in is a choice somebody made on screen, and the toggle writes the
 * cookie. Absent that choice, the default is `es-EC`.
 */
export const LOCALE_COOKIE = "eia.locale";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const chosen = store.get(LOCALE_COOKIE)?.value;
  if (chosen && isLocale(chosen)) return chosen;
  return DEFAULT_LOCALE;
}

/** The translator for this request. Server components take it as a value, not from a context. */
export async function getTranslator(): Promise<Translator> {
  return createTranslator(await getLocale());
}

/**
 * Words and numbers together, resolved once per request.
 *
 * A surface takes this object and passes it down. Nothing below decides for itself how a figure
 * reads or which language a label is in, which is the rule the whole catalogue exists to make
 * possible: there is no `locale === "en" ? … : …` anywhere in a component.
 */
export interface I18n {
  readonly locale: Locale;
  readonly t: Translator;
  readonly fmt: Format;
}

export async function getI18n(): Promise<I18n> {
  const locale = await getLocale();
  return { locale, t: createTranslator(locale), fmt: createFormat(locale) };
}

export function i18nFor(locale: Locale): I18n {
  return { locale, t: createTranslator(locale), fmt: createFormat(locale) };
}

export { DEFAULT_LOCALE };
export type { Format, Locale, Translator };
