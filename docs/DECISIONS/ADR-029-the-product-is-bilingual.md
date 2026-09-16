# ADR-029 — The product is bilingual, and a questionnaire is one version in two languages

- Status: Accepted
- Date: 16 September 2026
- Amends: ADR-025 (the product speaks Spanish) — the rule it set stands and is now enforced twice.
- Related: ADR-006 (survey versioning), ADR-013 (Drizzle + reviewed SQL), ADR-015 (domain purity),
  ADR-020 (the rule catalogue is code), ADR-021 (retrieval is full-text), ADR-024 (the PGAS is a
  document with a shape), ADR-027 (the portal is a publication), ADR-028 (EIA Field),
  `docs/I18N_ARCHITECTURE.md`, `docs/PRODUCT_LANGUAGE_ES.md`.

## Context

ADR-025 made every word on screen Spanish, and its rule — **a stored value is never rendered; a
label for it is** — was the right one. It was implemented with Spanish constants beside the values
they described: `PARCEL_STATUS_PRESENTATION.confirmed.label`, `REGIME_LABEL`, `LAYER_LEGEND_COPY`,
`AGREEMENT_SEMANTICS.help`, and about thirty more. That is a boundary a single-language product can
live with.

Production V1 does not have one audience. The eight rural-road projects are financed under IDB
guidelines, and the people who read a deliverable and audit a process in English are reviewers
rather than field staff. A consultant in Zamora Chinchipe and a reviewer in Washington need the
same product in different words — and the reviewer is not a reason to make the consultant read
English, which is what the product would have become if English had been added as the "real"
language with Spanish as a translation.

The bilingual requirement also reaches the **questionnaire**, which is not interface copy: it is
project data a technician reads aloud at a gate and a specialist tabulates afterwards. The obvious
implementation — publish `ficha_socioeconomica_es` and `socioeconomic_form_en` — would double every
question, split every tabulation across two versions, and make "how many households answered" a
question with two answers.

## Decision

### 1. The message catalogue is the boundary; the domain keeps values, not words

`@eia/i18n` holds two catalogues, `es-EC` and `en`, as typed objects. The Spanish one is the source
of truth: `Messages` is derived from it, so a key added in Spanish and forgotten in English **does
not compile**. Spanish is first because the copy was written for a consultancy in Ecuador and the
English is a rendering of it — not the other way round, which is how a product ends up sounding
translated in the language its users actually speak.

The Spanish label fields are **removed** from the domain's presentation tables. What stays there is
what is not language:

| Stays in `@eia/domain` | Moved to `@eia/i18n` |
|---|---|
| the enum (`PARCEL_STATUSES`, `REGIMES`, `LAYER_PROVENANCE_LEGENDS`, …) | its words (`vocabulary.parcelStatus.*`, `vocabulary.regime.*`, …) |
| the glyph beside a status — the same mark for either reader, and the accessibility guarantee | the label beside the glyph |
| `deriveSourceTypeLabel` — which of the four badges a value *is* | what each badge says |
| `FIELD_OFFLINE_MODE_SEMANTICS.allowsOnlineOnlyChannel` — whether a campaign may activate | what the mode is called |
| `CONFIDENCE_SEMANTICS.lowThreshold` — where the queue reorders | the sentence denying calibration |
| `QUALITY_REQUIREMENTS` — the rules, their versions, their severities | their titles and explanations |

The two are asserted to agree: `packages/i18n/test/i18n.test.ts` checks that every enum the product
renders has a word for every value **in both languages**, and that the domain's own Spanish for a
surface, a capability and a quality rule is identical to the catalogue's.

### 2. Nothing below a surface decides how something reads

A surface resolves the locale once — `getI18n()` on the server, `useI18n()` in the interactive half
— and passes `{ locale, t, fmt }` down. `@eia/ui` holds **no** copy and **no** formatter: the two
components that had one (`ProvenanceBadge`, `DemoBadge`) take a translator, `ActivityTable` and
`AppShell` take their labels, and `ForecastChart` takes formatted strings. There is no
`locale === "en" ? … : …` anywhere in a component, and a surface that formats a number the wrong way
in one place and the right way in the next is not a mistake this design can make.

Formatting is locale-aware and centralised: `7,4` against `7.4`, `28 ago 2026` against
`28 Aug 2026`. An **abscissa** (`2+840`) is deliberately not localised — it is surveying notation
written the same way on a Spanish drawing and an English one, and "translating" it would produce
something no engineer recognises. Parcel codes, EPSG codes and document codes are identifiers.

### 3. A bilingual questionnaire is one `SurveyVersion`

`survey_question_translation` and `survey_option_translation` carry a locale's wording, keyed by
question id or option id. They are **part of the definition**: the same
`assert_survey_definition_frozen` trigger that refuses an edit to a published question refuses a
translation added, reworded or deleted after publication. Publishing in a second language happens
before the flip, like everything else about a version.

The consequence is the point. There is one version, one definition hash, one set of codes, one
tabulation. An answer points at a question **code**, so a technician who filled the form in English
and a specialist who reads the tabulation in Spanish are looking at the same response. A question
nobody translated keeps its canonical Spanish wording rather than disappearing from the English
form: a missing translation is a gap in the wording, never a gap in the instrument.

The Field Pack carries the translations with the questions, so a phone that has been offline for
three days can still switch language — the wording came down with the work.

### 4. What is *not* translated, and why

Project source data. Translating any of it would be inventing a document nobody wrote.

- **Documents** are delivered in the language they were written in; a passage is quoted verbatim.
- **The management plan** is quoted in the study's own words, delivered spellings included
  (ADR-024).
- **A taxonomy's categories** are the coding scheme the study used.
- **A generated finding** is a record of what a check said when it ran, in the language it ran in.
  Its *rule* has words in both languages; the finding's own stored text does not (TD-086).
- **A report version** is a Spanish deliverable. Its snapshot's method sentences and its `.docx`
  are composed in Spanish whatever the reader's interface is set to, because a report is a document
  and not a view. The chrome around it follows the reader.
- **The client publication** is a statement the firm made to its customer on a date, stored as it
  was composed. Its page is rendered in the language it was published in, which today is always
  `es-EC`: translating the headings while the published figures stay Spanish would produce a page
  that is half one language and half the other and would imply the firm said something it did not.
  Publishing in a second language is a decision with a column behind it (TD-085), not a rendering
  choice.

### 5. The reader's choice is a cookie, and the default is Spanish

An explicit choice beats the browser's `Accept-Language`, which beats `es-EC`. A reviewer who
switched to English on this machine meant it; a Spanish-speaking consultant whose browser is
configured in English did not ask for an English product, which is why the default is last rather
than first. `es`, `es-419` and `es-MX` all resolve to `es-EC`, and `en-GB`/`en-US` to `en`.

It is a cookie and not a profile column because Better Auth owns identity and nothing else
(ADR-010): putting a product preference in the identity system is the boundary that ADR exists to
hold. When an account-level preference is wanted it becomes a row EIA Studio owns, and
`getLocale()` reads it first without anything else changing. On the phone the same choice is a row
in `mobile_meta`, so it survives a restart with no signal.

### 6. Invariant 11 holds in both languages

The Quality Gate's forbidden vocabulary gained its English equivalents — *non-compliance*,
*violation*, *breach of*, *unlawful*, *the system determines* — and the catalogue's own test asserts
every message in both languages against the whole list. An invariant that held only in Spanish
would not be an invariant; it would be an accident of which catalogue a reader happened to open.
The same test holds invariant 10: a model score is never an accuracy, and *calibrated probability*
may appear only inside a sentence denying it.

## Consequences

- A third language is a decision somebody takes — a catalogue, a `LOCALES` entry and a pass over
  the vocabulary — not a gap this design leaves open. Nothing in the code branches on "which
  language"; it branches on the catalogue.
- A domain test can no longer assert a label, because the domain no longer holds one. Six such
  assertions moved to `packages/i18n/test/i18n.test.ts`, where they now hold for both languages at
  once, and the domain tests that replaced them assert the *set* instead of the words.
- `@eia/ui` gained a dependency on `@eia/i18n` for the `Translator` and `Format` types. It holds no
  strings.
- A reviewer reading the English interface still sees the study's Spanish content. That is correct,
  and the e2e suite encodes it: the English vocabulary check forbids Spanish **interface** copy and
  deliberately does not forbid Spanish content.
