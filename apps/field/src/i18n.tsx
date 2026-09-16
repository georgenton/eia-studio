import {
  createTranslator,
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  type Translator,
} from "@eia/i18n";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { readMeta, writeMeta } from "./db/repo";
import type * as SQLite from "expo-sqlite";

/**
 * The language EIA Field speaks, and the rule that matters most about it: **changing it needs no
 * network.**
 *
 * The catalogue is in the bundle, the choice is a row in the local database, and both are on the
 * device before the technician leaves. A language switch that required a server round trip would
 * be a language switch that does not work in the place this application exists for.
 *
 * `@eia/i18n` has no dependencies at all — not even zod — so it costs the bundle a few kilobytes of
 * strings and nothing else.
 */
const LOCALE_KEY = "locale";

interface LocaleState {
  readonly t: Translator;
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
}

const Ctx = createContext<LocaleState | null>(null);

export function useT(): Translator {
  const state = useContext(Ctx);
  if (!state) throw new Error("useT outside LocaleGate");
  return state.t;
}

export function useLocaleState(): LocaleState {
  const state = useContext(Ctx);
  if (!state) throw new Error("useLocaleState outside LocaleGate");
  return state;
}

export function LocaleGate({
  db,
  children,
}: {
  db: SQLite.SQLiteDatabase | null;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Read the stored choice once the database is open. Until then the default is used, which is the
  // right guess: this product's technicians read Spanish.
  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    void readMeta(db, LOCALE_KEY).then((stored) => {
      if (!cancelled && stored && isLocale(stored)) setLocaleState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [db]);

  const value = useMemo<LocaleState>(
    () => ({
      locale,
      t: createTranslator(locale),
      setLocale: (next: Locale) => {
        setLocaleState(next);
        if (db) void writeMeta(db, LOCALE_KEY, next);
      },
    }),
    [db, locale],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
