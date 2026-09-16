import {
  AFFECTATION_CATEGORIES,
  CAPABILITY_KEYS,
  CAPABILITY_CATALOG,
  ASSIGNMENT_STATUSES,
  ATTENTION_SEVERITIES,
  BASEMAP_MODES,
  CAMPAIGN_STATUSES,
  CAPTURE_CHANNELS,
  CHAINAGE_METHODS,
  FIELD_OFFLINE_MODES,
  FORBIDDEN_FINDING_WORDS,
  INSTANCE_STATUSES,
  LAYER_PROVENANCE_LEGENDS,
  LOCATION_OUTCOMES,
  PARCEL_SIDES,
  PARCEL_STATUSES,
  PROJECT_LIFECYCLES,
  QUALITY_REQUIREMENTS,
  PROJECT_ROLES,
  SYSTEM_PROFILES,
  GRANULARITIES,
  ORIGINS,
  REGIMES,
  TRANSFORMATIONS,
  REVIEW_DECISIONS,
  SURFACE_DEFINITIONS,
  TENANT_ROLES,
  VALIDATION_STATES,
  VISIT_STATUSES,
  WORKSPACE_SURFACES,
} from "@eia/domain";
import { describe, expect, it } from "vitest";

import {
  createFormat,
  createTranslator,
  DEFAULT_LOCALE,
  formatBytes,
  formatCount,
  formatDateTime,
  formatDecimal,
  formatIsoDate,
  formatIsoDateShort,
  formatPercent,
  isLocale,
  LOCALE_ENDONYM,
  LOCALES,
  localeCandidatesFromHeader,
  resolveLocale,
} from "../src/index";
import { messages as en } from "../src/messages/en";
import { messages as esEC } from "../src/messages/es-EC";

/**
 * The catalogue's own tests.
 *
 * Two of them are the reason the file exists. **The key sets must be identical**, because a key
 * present in one language and absent from the other is a blank on somebody's screen. And **neither
 * language may state a compliance conclusion** (invariant 11): an invariant that held only in
 * Spanish would be an accident of which catalogue a reader opened.
 */

/** Every leaf of the catalogue, as a dotted path, so the two can be compared key for key. */
function paths(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    paths(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

function leaves(node: unknown, prefix = ""): Array<[string, string]> {
  if (typeof node === "string") return [[prefix, node]];
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

const CATALOGUES: ReadonlyArray<[string, unknown]> = [
  ["es-EC", esEC],
  ["en", en],
];

describe("the two catalogues", () => {
  it("hold exactly the same keys", () => {
    const spanish = paths(esEC).sort();
    const english = paths(en).sort();
    expect(english).toEqual(spanish);
  });

  it("agrees with the domain's own Spanish name for every surface", () => {
    // `SurfaceDefinition.label` is what a log line or a domain test calls a surface. What a reader
    // sees is `surface.<key>`, and the two drifting apart would mean the rail and the record of
    // what somebody opened no longer name the same thing.
    const t = createTranslator("es-EC");
    for (const key of WORKSPACE_SURFACES) {
      const surfaceKey = key === "command-center" ? "commandCenter" : key;
      expect(t(`surface.${surfaceKey}` as Parameters<typeof t>[0]), key).toBe(
        SURFACE_DEFINITIONS[key].label,
      );
    }
  });

  it("agrees with the domain's own Spanish copy for every quality rule", () => {
    // The rule catalogue is code, not a table (ADR-020), and its words are what a specialist reads
    // to know what was checked. They are rendered from here; the domain keeps the same Spanish so
    // that a generated finding and the rule it names cannot end up saying different things.
    const t = createTranslator("es-EC");
    for (const requirement of QUALITY_REQUIREMENTS) {
      const flat = requirement.key.replace(/\./g, "_");
      for (const field of ["title", "what", "whyFlagged", "suggestedAction"] as const) {
        expect(
          t(`vocabulary.requirement.${flat}.${field}` as Parameters<typeof t>[0]),
          `${requirement.key}.${field}`,
        ).toBe(requirement[field]);
      }
    }
  });

  it("agrees with the domain's own Spanish name for every capability", () => {
    const t = createTranslator("es-EC");
    for (const key of CAPABILITY_KEYS) {
      const flat = key.replace(".", "_");
      expect(t(`vocabulary.capability.${flat}` as Parameters<typeof t>[0]), key).toBe(
        CAPABILITY_CATALOG[key].label,
      );
    }
  });

  it("has a catalogue for every declared locale", () => {
    expect(LOCALES.map((locale) => LOCALE_ENDONYM[locale])).toEqual(["Español", "English"]);
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it.each(CATALOGUES)("%s leaves no message blank", (_name, catalogue) => {
    for (const [key, value] of leaves(catalogue)) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it.each(CATALOGUES)("%s never renders an identifier as if it were a word", (_name, catalogue) => {
    // `SCREAMING_SNAKE_CASE`, a dotted key or a capability name reaching a screen is the failure
    // ADR-025 exists to prevent: a stored value is never rendered, a label for it is.
    for (const [key, value] of leaves(catalogue)) {
      if (key.startsWith("vocabulary.validationState")) continue; // deliberate: the approved badges
      expect(value, key).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
      expect(value, key).not.toMatch(/\b[a-z]+\.[a-z_]+\.[a-z_]+\b/);
    }
  });

  it.each(CATALOGUES)("%s states no compliance conclusion", (_name, catalogue) => {
    for (const [key, value] of leaves(catalogue)) {
      const haystack = value.toLowerCase();
      for (const word of FORBIDDEN_FINDING_WORDS) {
        expect(haystack.includes(word), `${key} contains "${word}"`).toBe(false);
      }
    }
  });

  it("never calls a model score an accuracy", () => {
    // Invariant 10. A score is a model score; it is not a percentage of right answers.
    for (const [, catalogue] of CATALOGUES) {
      for (const [key, value] of leaves(catalogue)) {
        const haystack = value.toLowerCase();
        for (const phrase of ["% de acierto", "precisión del", "accuracy rate", "% accurate"]) {
          expect(haystack.includes(phrase), `${key} contains "${phrase}"`).toBe(false);
        }
      }
    }
  });

  it("only mentions a calibrated probability in order to deny it", () => {
    // The approved copy says a score is *not* a calibrated probability, so the phrase is allowed
    // exactly where it is being refused. A message that used it as a claim would read as the
    // opposite of what invariant 10 requires, and the difference is the negation in front of it.
    const DENIALS = ["no es una", "no es", "is not a", "is not", "not a"];
    for (const [name, catalogue] of CATALOGUES) {
      for (const [key, value] of leaves(catalogue)) {
        const haystack = value.toLowerCase();
        for (const phrase of ["probabilidad calibrada", "calibrated probability"]) {
          const at = haystack.indexOf(phrase);
          if (at === -1) continue;
          const before = haystack.slice(Math.max(0, at - 24), at);
          expect(
            DENIALS.some((denial) => before.includes(denial)),
            `${name}: ${key} states "${phrase}" rather than denying it`,
          ).toBe(true);
        }
      }
    }
  });
});

/**
 * Every stored value the product renders, beside the namespace that gives it words.
 *
 * This is ADR-025's rule made checkable. A value added to an enum without a label used to render
 * as `NOT_LOCATED` on somebody's screen; now it fails here, in both languages at once, before it
 * reaches one.
 */
const RENDERED_VALUES: ReadonlyArray<[string, ReadonlyArray<string>]> = [
  ["tenantRole", TENANT_ROLES],
  ["projectRole", PROJECT_ROLES],
  ["regime", REGIMES],
  ["origin", ORIGINS],
  ["transformation", TRANSFORMATIONS],
  ["granularity", GRANULARITIES],
  ["validationState", VALIDATION_STATES],
  ["sourceType", ["REAL_AGGREGATE", "RECONSTRUCTED", "ANONYMIZED", "SYNTHETIC"]],
  ["sourceTypeNote", ["REAL_AGGREGATE", "RECONSTRUCTED", "ANONYMIZED", "SYNTHETIC"]],
  ["parcelSide", PARCEL_SIDES],
  ["parcelStatus", PARCEL_STATUSES],
  ["parcelStatusNote", PARCEL_STATUSES],
  ["layerLegend", LAYER_PROVENANCE_LEGENDS],
  ["layerLegendNote", LAYER_PROVENANCE_LEGENDS],
  ["affectationCategory", AFFECTATION_CATEGORIES],
  ["chainageMethod", CHAINAGE_METHODS],
  ["basemapMode", BASEMAP_MODES],
  ["attentionSeverity", ATTENTION_SEVERITIES],
  ["capability", CAPABILITY_KEYS.map((key) => key.replace(".", "_"))],
  ["lifecycle", PROJECT_LIFECYCLES],
  ["profile", [...SYSTEM_PROFILES.keys()]],
  ["profileDescription", [...SYSTEM_PROFILES.keys()]],
  ["assignmentStatus", ASSIGNMENT_STATUSES],
  ["campaignStatus", CAMPAIGN_STATUSES],
  ["visitStatus", VISIT_STATUSES],
  ["instanceStatus", INSTANCE_STATUSES],
  ["locationOutcome", LOCATION_OUTCOMES],
  ["reviewDecision", REVIEW_DECISIONS],
  ["offlineMode", FIELD_OFFLINE_MODES],
  ["offlineModeDescription", FIELD_OFFLINE_MODES],
  ["captureChannel", CAPTURE_CHANNELS],
  ["captureChannelNote", CAPTURE_CHANNELS],
];

describe("the words for stored values", () => {
  it.each(RENDERED_VALUES)("%s has a word for every value, in both languages", (ns, values) => {
    for (const [name, catalogue] of CATALOGUES) {
      const vocabulary = (catalogue as { vocabulary: Record<string, unknown> }).vocabulary;
      const namespace = vocabulary[ns];
      expect(namespace, `${name}: vocabulary.${ns}`).toBeDefined();
      expect(Object.keys(namespace as object).sort(), `${name}: vocabulary.${ns}`).toEqual(
        [...values].sort(),
      );
    }
  });

  it("gives no namespace a word for a value that does not exist", () => {
    // The assertion above is an equality, so an extra key fails it too. Stated separately because
    // the failure means something different: dead copy for a value nothing can produce, which a
    // reader of the catalogue would take for a state the product has.
    const declared = new Set(RENDERED_VALUES.map(([ns]) => ns));
    const known = new Set([
      ...declared,
      "requirement",
      "documentProcessing",
      "documentPrivacy",
      "mediaState",
    ]);
    for (const ns of Object.keys(esEC.vocabulary)) {
      expect(known.has(ns), `vocabulary.${ns} is not covered by a test`).toBe(true);
    }
  });
});

describe("the words a technician reads offline", () => {
  it("keeps the one distinction the product exists to make, in both languages", () => {
    // *Submitted on the device* and *synced* are different facts, and a phone that blurred them
    // would let a technician walk away from a valley believing the work had arrived.
    for (const locale of LOCALES) {
      const t = createTranslator(locale);
      const ready = t("mobile.localSurveyState.READY_TO_SYNC").toLowerCase();
      expect(ready, locale).not.toBe(t("mobile.localSurveyState.SYNCED").toLowerCase());
      expect(
        /dispositivo|device/.test(ready) && /pendiente|pending|awaiting/.test(ready),
        `${locale}: READY_TO_SYNC must say both "on the device" and "pending"`,
      ).toBe(true);
    }
  });
});

describe("choosing a locale", () => {
  it("accepts only the declared locales", () => {
    expect(isLocale("es-EC")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("es")).toBe(false);
  });

  it("gives a Spanish speaker Spanish, whatever their country", () => {
    expect(resolveLocale(["es"])).toBe("es-EC");
    expect(resolveLocale(["es-419"])).toBe("es-EC");
    expect(resolveLocale(["es-MX"])).toBe("es-EC");
    expect(resolveLocale(["ES-mx"])).toBe("es-EC");
  });

  it("gives an English speaker English, whatever their country", () => {
    expect(resolveLocale(["en-GB"])).toBe("en");
    expect(resolveLocale(["en-US"])).toBe("en");
  });

  it("falls back to Spanish rather than to nothing", () => {
    expect(resolveLocale([])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale([null, undefined, "", "  "])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(["fr-CA", "de"])).toBe(DEFAULT_LOCALE);
  });

  it("prefers an explicit choice over a browser header", () => {
    expect(resolveLocale(["en", ...localeCandidatesFromHeader("es-EC,es;q=0.9")])).toBe("en");
  });

  it("honours the quality values a browser sends", () => {
    expect(localeCandidatesFromHeader("es;q=0.8,en;q=0.9")).toEqual(["en", "es"]);
    expect(localeCandidatesFromHeader("en-GB,en;q=0.9,es;q=0.1")).toEqual(["en-GB", "en", "es"]);
    expect(localeCandidatesFromHeader(null)).toEqual([]);
    expect(localeCandidatesFromHeader("")).toEqual([]);
  });
});

describe("looking a message up", () => {
  it("says something different in each language", () => {
    const es = createTranslator("es-EC");
    const enT = createTranslator("en");
    expect(es("surface.commandCenter")).toBe("Centro de control");
    expect(enT("surface.commandCenter")).toBe("Command Centre");
  });

  it("fills placeholders and leaves unknown ones alone", () => {
    const t = createTranslator("es-EC");
    expect(t("systemState.errorBody", { reference: "e7c1-9a44" })).toContain("e7c1-9a44");
    expect(t("systemState.errorBody")).toContain("{reference}");
  });

  it("never renders a key", () => {
    const t = createTranslator("en");
    // A key absent from both catalogues cannot be typed, so it is forced here: what matters is
    // that a reader is shown a dash rather than the inside of the machine.
    const value = (t as unknown as (key: string) => string)("nowhere.at.all");
    expect(value).not.toContain("nowhere");
    expect(value).toBe("—");
  });

  it("carries its own locale", () => {
    expect(createTranslator("en").locale).toBe("en");
    expect(createTranslator("es-EC").locale).toBe("es-EC");
  });
});

describe("formatting", () => {
  it("writes a decimal the way each language does", () => {
    expect(formatDecimal("es-EC", 7.4)).toBe("7,4");
    expect(formatDecimal("en", 7.4)).toBe("7.4");
    expect(formatPercent("es-EC", 0.863, 1)).toBe("86,3%");
    expect(formatPercent("en", 0.863, 1)).toBe("86.3%");
    expect(formatCount("es-EC", 141)).toBe("141");
  });

  it("writes a calendar date without shifting it by timezone", () => {
    expect(formatIsoDate("es-EC", "2026-08-28")).toMatch(/28.*2026/);
    expect(formatIsoDate("en", "2026-08-28")).toMatch(/28.*2026/);
    expect(formatIsoDate("es-EC", "2026-08-28")).not.toBe(formatIsoDate("en", "2026-08-28"));
    expect(formatIsoDateShort("es-EC", "2026-01-01")).not.toContain("2026");
    expect(formatDateTime("en", new Date("2026-08-28T13:05:00Z"))).toContain("2026");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(formatIsoDate("en", "no es una fecha")).toBe("no es una fecha");
    expect(formatIsoDateShort("en", "")).toBe("");
  });

  it("reports a file size a person can read", () => {
    expect(formatBytes("en", 900)).toBe("900 B");
    expect(formatBytes("en", 1024 * 1024 * 3.5)).toMatch(/3\.5 MB/);
    expect(formatBytes("es-EC", 1024 * 1024 * 3.5)).toMatch(/3,5 MB/);
  });

  it("binds every formatter to one locale at once", () => {
    const fmt = createFormat("en");
    expect(fmt.locale).toBe("en");
    expect(fmt.decimal(7.4)).toBe("7.4");
    expect(fmt.percent(0.5, 0)).toBe("50%");
    expect(fmt.count(1200)).toBe(formatCount("en", 1200));
  });
});
