import type { Messages } from "./messages/es-EC";
import { messages as esEC } from "./messages/es-EC";
import { messages as en } from "./messages/en";
import { DEFAULT_LOCALE, type Locale } from "./locales";

/**
 * Looking a message up, and what happens when one is missing.
 *
 * ## The key set is the Spanish catalogue
 *
 * `Messages` is derived from `es-EC`, so the English catalogue is type-checked against it: a key
 * added in Spanish and forgotten in English **does not compile**. That is the whole reason the
 * catalogues are typed objects rather than JSON files — a missing translation should be a build
 * error on a laptop, not a `documents.upload.title` printed on a reviewer's screen.
 *
 * ## Fallback
 *
 * If a key is somehow absent at runtime (a catalogue loaded from elsewhere, a future locale added
 * without a full pass), the Spanish string is used and the key is *never* rendered. A reader who
 * gets one Spanish sentence in an English page has been mildly inconvenienced; a reader who gets
 * `quality.finding.state.ACCEPTED` has been shown the inside of the machine (ADR-025).
 */
const CATALOGUES: Readonly<Record<Locale, Messages>> = {
  "es-EC": esEC,
  en,
};

export type MessageParams = Readonly<Record<string, string | number>>;

/** Every dotted path into the catalogue, derived so a typo is a compile error. */
export type MessageKey = Paths<Messages>;

type Paths<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
    }[keyof T & string];

function lookup(catalogue: Messages, key: string): string | undefined {
  let node: unknown = catalogue;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * `{name}` placeholders, and nothing more.
 *
 * No pluralisation engine and no ICU syntax: the product has a handful of counted phrases, and
 * each is written as two keys the caller chooses between. A message format is a small language, and
 * a small language in a catalogue is a large feature nobody asked for.
 */
function interpolate(template: string, params: MessageParams | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export interface Translator {
  readonly locale: Locale;
  (key: MessageKey, params?: MessageParams): string;
}

export function createTranslator(locale: Locale): Translator {
  const catalogue = CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];
  const translate = ((key: MessageKey, params?: MessageParams) => {
    const value = lookup(catalogue, key) ?? lookup(CATALOGUES[DEFAULT_LOCALE], key);
    // A key that exists in neither is a bug; returning the Spanish catalogue's own fallback text
    // keeps a screen readable while the test suite fails loudly about it.
    return interpolate(
      value ?? lookup(CATALOGUES[DEFAULT_LOCALE], "common.missing") ?? "—",
      params,
    );
  }) as Translator;
  return Object.assign(translate, { locale });
}

export function catalogueFor(locale: Locale): Messages {
  return CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];
}

export type { Messages };
