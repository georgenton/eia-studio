"use client";

import {
  createFormat,
  createTranslator,
  type Format,
  type Locale,
  type Translator,
} from "@eia/i18n";
import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * The locale, for the parts of the interface that run in the browser.
 *
 * Server components read the request's locale directly (`getLocale`), which is the cheaper and
 * more honest path: there is no flash of the wrong language, and no catalogue is shipped to the
 * client for a page that renders on the server. This context exists for the client components that
 * genuinely need to translate during an interaction — a form's validation message, a sync status,
 * a button that changes while you press it.
 */
const LocaleContext = createContext<Locale | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  const locale = useContext(LocaleContext);
  if (!locale) throw new Error("useLocale outside LocaleProvider");
  return locale;
}

export function useTranslator(): Translator {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}

export interface ClientI18n {
  readonly locale: Locale;
  readonly t: Translator;
  readonly fmt: Format;
}

/** The same `{ locale, t, fmt }` a server component receives, for the interactive half. */
export function useI18n(): ClientI18n {
  const locale = useLocale();
  return useMemo(
    () => ({ locale, t: createTranslator(locale), fmt: createFormat(locale) }),
    [locale],
  );
}
