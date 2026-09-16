# Internationalisation

> Decision: ADR-029 (the product is bilingual, and a questionnaire is one version in two
> languages), amending ADR-025 (the product speaks Spanish). Vocabulary: `PRODUCT_LANGUAGE_ES.md`.

## 1. The two languages, and which is first

`es-EC` and `en`. Spanish (Ecuador) is the default and the source of truth; English is a rendering
of it. `Messages` is derived from the Spanish catalogue, so **a key added in Spanish and forgotten
in English does not compile** — a missing translation is a build error on a laptop, not
`documents.upload.title` printed on a reviewer's screen.

`es-EC` and not `es`: the copy is specific to Ecuadorian usage — decimal commas, `28 ago 2026`,
abscissas like `2+840`, and the vocabulary a consultancy actually uses. English exists because the
programme is financed under IDB guidelines and its reviewers read in English. That is a second
audience, not a first step towards a locale menu.

## 2. Where the words live

```
packages/i18n/
  src/locales.ts          LOCALES, DEFAULT_LOCALE, resolveLocale, localeCandidatesFromHeader
  src/format.ts           locale-aware number/date/size formatting, and createFormat(locale)
  src/translate.ts        createTranslator(locale), MessageKey, {name} interpolation
  src/messages/es-EC.ts   the source of truth; Messages is derived from it
  src/messages/en.ts      typed against Messages
  test/i18n.test.ts       the catalogue's own guarantees (§6)
```

Namespaces: `common`, `locale`, `auth`, `shell`, `surface`, `systemState`, `actions`, `provenance`,
`commandCenter`, `portfolio`, `gis`, `parcel`, `field`, `social`, `quality`, `pgas`, `documents`,
`reports`, `portal`, `vocabulary`, `mobile`.

`vocabulary` is the one that matters architecturally: it holds **the words for stored values**, keyed
by the value. `vocabulary.parcelStatus.confirmed`, `vocabulary.regime.DEMO_SIMULATION`,
`vocabulary.requirement.rule_affectation_count.title`. That is ADR-025's rule — *a stored value is
never rendered; a label for it is* — made into a place rather than a habit.

### Keys carry no dots

Lookup walks a dotted path, so a key containing a dot would be unreachable. Values that carry one —
capability keys (`core.projects`), quality rule keys (`rule.affectation_count`), sync command types
(`visit.start`) — are flattened at the call site (`core_projects`, `rule_affectation_count`,
`visitStart`) and the mapping lives beside the call, not in the catalogue.

## 3. What the domain keeps

The domain holds values and rules. It holds no copy.

| `@eia/domain` | `@eia/i18n` |
|---|---|
| `PARCEL_STATUSES`, `REGIMES`, `LAYER_PROVENANCE_LEGENDS`, `PROJECT_LIFECYCLES`, … | their words |
| the **glyph** beside a status (the same mark in either language, and the accessibility guarantee) | the label beside it |
| `deriveSourceTypeLabel` — which of the four badges a value *is* (invariant 13) | what each badge says |
| `FIELD_OFFLINE_MODE_SEMANTICS.allowsOnlineOnlyChannel` — whether a campaign may activate | what the mode is called |
| `CONFIDENCE_SEMANTICS.lowThreshold` — where the review queue reorders | the sentence denying calibration |
| `QUALITY_REQUIREMENTS` — the rules, versions, severities, and the forbidden-vocabulary list | their titles, `what`, `whyFlagged` and `suggestedAction` |
| `CAPABILITY_CATALOG` structure and `SURFACE_DEFINITIONS.label` (the domain's own name, for logs and tests) | what a reader sees for the same key |

`SURFACE_DEFINITIONS.label` and `CAPABILITY_CATALOG[key].label` deliberately stay, and the
catalogue's test asserts they are **identical** to the `es-EC` strings. A domain that cannot say
what a surface is called is one that has to be joined to a catalogue to be read in a test or a log
line; what the test prevents is the two drifting apart.

## 4. How a surface gets them

Resolve once, pass down. There is no `locale === "en" ? … : …` in any component.

```ts
// server component / page / server action
const i18n = await getI18n();          // { locale, t, fmt }
const { t } = await getTranslator();   // when only words are needed

// client component
const { t, fmt } = useI18n();
```

`apps/web/lib/labels.ts` is the join between a stored value and its word:
`parcelStatusLabel(t, status)`, `regimeLabel(t, facets.regime)`, `surfaceLabel(t, key)`. Every one
is a one-line lookup on purpose — the alternative is a `switch` per surface, which is how a product
ends up saying *Confirmado* in one table and *Confirmed* in the next.

**`@eia/ui` holds no copy and no formatter.** `ProvenanceBadge` and `DemoBadge` take a translator
(a prop, not a context — they render inside server components); `ActivityTable` and `AppShell` take
their labels; `ForecastChart` takes already-formatted strings. `formatMetricValue(metric, fmt)`
takes the bound formatter.

## 5. Formatting, and what is deliberately not formatted

`createFormat(locale)` binds `count`, `decimal`, `percent`, `isoDate`, `isoDateShort`, `dateTime`,
`time` and `bytes`. Dates are parsed as UTC so a calendar date never shifts by a timezone.

Not localised, and not by oversight:

- **Abscissas** (`2+840`). Surveying notation for "two kilometres and 840 metres along the
  alignment", written identically on a Spanish drawing and an English one. It lives in
  `@eia/domain` beside the arithmetic that produces it.
- **Parcel codes, EPSG codes, document codes, finding codes, version labels.** Identifiers.
- **A model's or an adapter's name**, a prompt hash, a definition hash. Evidence.

## 6. What the catalogue's tests guarantee

`packages/i18n/test/i18n.test.ts`:

1. **The two catalogues hold exactly the same keys.** A blank on somebody's screen is not a
   translation gap the product can have.
2. **No message is empty, and none renders an identifier shape** — `SCREAMING_SNAKE_CASE` or a
   dotted key reaching a reader is ADR-025's failure, in either language.
3. **Every stored value the product renders has a word in both languages.** A table pairs each
   domain enum with its namespace, so adding a status without a label fails here rather than on a
   screen. An *extra* key fails too: dead copy for a value nothing can produce reads as a state the
   product has.
4. **Invariant 11 in both languages.** Every message is checked against
   `FORBIDDEN_FINDING_WORDS`, which now carries the English equivalents (*non-compliance*,
   *violation*, *breach of*, *unlawful*, *the system determines*, …).
5. **Invariant 10 in both languages.** No message calls a model score an accuracy, and
   *calibrated probability* may appear only inside a sentence denying it.
6. **The domain's own Spanish agrees** with the catalogue for every surface, capability and quality
   rule.
7. **The offline distinction survives translation**: *submitted on the device* and *synced* are
   different sentences in both languages, because a phone that blurred them would let a technician
   walk away from a valley believing the work had arrived.

`e2e/vocabulary.spec.ts` checks the rendered product twice: every surface in Spanish with no
identifier and no leaked English (ADR-025), and every surface in English with no identifier and no
leaked Spanish **interface** copy. It deliberately does not forbid Spanish *content* — see §8.

## 7. The bilingual questionnaire

One `SurveyVersion`, two languages. `survey_question_translation` and `survey_option_translation`
carry a locale's wording keyed by question or option id, and they are part of the definition: the
same `assert_survey_definition_frozen` trigger freezes them when the version is published.

- **Answers point at codes**, so a form filled in English and a tabulation read in Spanish are the
  same response.
- **A missing translation falls back to the canonical Spanish wording** rather than disappearing: a
  gap in the wording is never a gap in the instrument.
- **The Field Pack carries the translations**, so a phone offline for three days can still switch
  language.

Migrations: `0034_survey_translations.sql` (tables) and `0035_survey_translations_rls.sql` (grants,
FORCE RLS under the ordinary project predicate, and the extended freeze trigger).

## 8. What is not translated

Project source data, because translating it would be inventing a document nobody wrote: delivered
**documents** and the passages quoted from them; the **management plan** in the study's own words
and spellings (ADR-024); a **taxonomy's** categories; a **generated finding's** stored text, which
is a record of what a check said when it ran (TD-086); a **report version**, which is a Spanish
deliverable whatever the reader's interface says; and the **client publication**, which is rendered
in the language it was published in (TD-085).

The interface *around* each of those follows the reader.

## 9. Adding a language

1. Add it to `LOCALES`, `LOCALE_ENDONYM` and `LOCALE_TAG`, and a branch in `resolveLocale`.
2. Add `packages/i18n/src/messages/<locale>.ts` typed `Messages`. The compiler names every key.
3. Run `pnpm test:unit` — every guarantee in §6 applies to the new catalogue automatically.
4. Decide what the *questionnaires* do: a language in the interface is not a language in the
   instrument, and publishing one is a decision somebody takes per survey version.
