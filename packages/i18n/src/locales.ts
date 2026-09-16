/**
 * The two languages EIA Studio speaks, and the rule for choosing between them.
 *
 * ## Why `es-EC` is the default and not `es`
 *
 * The product was designed in Ecuadorian Spanish and its copy is specific to it: decimal commas,
 * `28 ago 2026`, abscissas like `2+840`, and the vocabulary an Ecuadorian consultancy actually
 * uses. A generic `es` would be a claim this product does not make.
 *
 * ## Why English and not "translations" in general
 *
 * The eight-road programme is financed under IDB guidelines, and the people who read a deliverable
 * in English are reviewers rather than field staff. That is a real second audience with real
 * vocabulary, not a first step towards a locale menu. A third language is a decision somebody
 * takes, not a gap this design leaves open.
 *
 * ## What is *not* translated
 *
 * Project source data. A document delivered in Spanish stays Spanish; a plan's measures are quoted
 * verbatim in the words the study used (ADR-024); a parcel code is a code. Translating any of those
 * would be inventing a document nobody wrote.
 */
export const LOCALES = ["es-EC", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es-EC";

/** What each language calls itself. Never translated — a language menu is read in its own tongue. */
export const LOCALE_ENDONYM: Readonly<Record<Locale, string>> = {
  "es-EC": "Español",
  en: "English",
};

/**
 * BCP-47 tag for `Intl`, which is not always the catalogue's own key.
 *
 * `en` formats as **`en-GB`**: a day-first date (`17 Sept 2026`) and a 24-hour clock read the same
 * way round as the Spanish half of the product, and `Sep 17, 2026` beside `17 sept 2026` on two
 * versions of one screen is exactly the ambiguity a study's dates cannot afford. The catalogue key
 * stays `en` because the *words* are not British; only the number and date conventions are.
 */
export const LOCALE_TAG: Readonly<Record<Locale, string>> = {
  "es-EC": "es-EC",
  en: "en-GB",
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as ReadonlyArray<string>).includes(value);
}

/**
 * Pick a locale from whatever the caller knows, in order of how much it means.
 *
 * An explicit choice beats a browser header, which beats the default. Matching is by language
 * subtag, so `es`, `es-419` and `es-MX` all resolve to `es-EC` — a Spanish speaker gets Spanish,
 * and the fact that the copy is Ecuadorian is a detail they can live with far better than English.
 *
 * `en-GB` and `en-US` both resolve to `en` for the same reason.
 */
export function resolveLocale(candidates: ReadonlyArray<string | null | undefined>): Locale {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = candidate.trim().toLowerCase();
    if (value === "") continue;
    if (isLocale(value)) return value;
    const language = value.split("-")[0];
    if (language === "es") return "es-EC";
    if (language === "en") return "en";
  }
  return DEFAULT_LOCALE;
}

/**
 * Parse an `Accept-Language` header into candidates, best first.
 *
 * Quality values are honoured because they are the only signal a browser gives about *preference*
 * rather than availability, and a reviewer whose browser says `en;q=0.9, es;q=0.8` has told us
 * something worth respecting.
 */
export function localeCandidatesFromHeader(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((param) => /^q=([\d.]+)$/.exec(param.trim())?.[1])
        .find((value) => value !== undefined);
      return { tag: (tag ?? "").trim(), quality: q === undefined ? 1 : Number(q) };
    })
    .filter((entry) => entry.tag !== "" && Number.isFinite(entry.quality) && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.tag);
}
