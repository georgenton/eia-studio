import "server-only";

import {
  DEFAULT_LOCALE,
  createFormat,
  createTranslator,
  isLocale,
  localeCandidatesFromHeader,
  resolveLocale,
  type Format,
  type Locale,
  type Translator,
} from "@eia/i18n";
import { cookies, headers } from "next/headers";

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
 * An explicit choice beats what the browser advertised, which beats the default. A reviewer who
 * switched to English on this machine meant it; a Spanish-speaking consultant whose browser is
 * configured in English did not ask for an English product, which is why the default is last
 * rather than first.
 */
export const LOCALE_COOKIE = "eia.locale";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const chosen = store.get(LOCALE_COOKIE)?.value;
  if (chosen && isLocale(chosen)) return chosen;
  const accept = (await headers()).get("accept-language");
  return resolveLocale(localeCandidatesFromHeader(accept));
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
