# ADR-025 — The product speaks Spanish, and provenance stops shouting

- Status: Accepted
- Date: 4 September 2026
- Related: ADR-005 (faceted provenance), ADR-016 (surface access), ARCHITECTURE §11a (what a visual
  reference may decide), PRODUCT.md §8 (language and locale), invariants 4 and 13.
- Amends: the approved design bundle's English module names and its four SOURCE TYPE badge labels,
  recorded in `docs/DESIGN_BUNDLE_KNOWN_ISSUES.md`.

## Context

The people who will use this product are environmental consultants in Ecuador. The approved design
bundle is written for them in every respect but one: the words. Its rail says *Command Center*,
*Field Surveys*, *Social Intelligence*, *Quality Gate*, *Documents*, *Reports*; its provenance
drawer is headed *DATA PROVENANCE* and its validation field *Human validation*; and its four SOURCE
TYPE badges are the enum names — `REAL_AGGREGATE`, `RECONSTRUCTED`, `ANONYMIZED`, `SYNTHETIC` —
printed on screen in capitals, with the Spanish explanation only in the spec.

Implementation added more of the same, because a component that renders a domain value directly
produces this without anyone deciding to: the map legend read `OFFICIAL IMPORTED ALIGNMENT`, panels
carried a solid black **DEMO** badge, and the demo fixture's own activity feed named the modules in
English.

Individually each is small. Together they turn a product for consultants into a debugging view of
its own database — and the badge is the worst case, because it is the one place a reader goes to
decide whether a figure may be quoted in a study. `REAL_AGGREGATE` does not answer that question for
someone who does not already know the schema.

## Decision

### 1. Every word on screen is Spanish, and the identifiers stay behind it

The keys, the capability names, the URL segments, the enum values and the database do not change.
Only the labels do. The rule is a boundary rather than a translation pass: **a stored value is never
rendered; a label for it is.**

| Where | Was | Is |
|---|---|---|
| Rail | Command Center · Field Surveys · Social Intelligence · Quality Gate · Documents · Reports · GIS & Predios | Centro de control · Trabajo de campo · Análisis social · Control de calidad · Documentos · Informes · Cartografía y predios |
| Provenance drawer | DATA PROVENANCE · Human validation | ORIGEN DEL DATO · Validación humana |
| SOURCE TYPE badge | REAL_AGGREGATE · RECONSTRUCTED · ANONYMIZED · SYNTHETIC | Dato histórico · Dato calculado · Agregado sin datos personales · Simulación operativa |
| Map legend | REAL BASE MAP · OFFICIAL IMPORTED ALIGNMENT · IMPORTED STUDY LAYER · … | Cartografía base real · Eje vial del estudio · Capa del estudio · … |
| Panel badge | **DEMO** / **DEMO / SYNTHETIC** | Simulación operativa |

### 2. The badge keeps its four categories; only the words change

`deriveSourceTypeLabel` still returns the four keys of invariant 13, still derives them from the
facets at render time, and still stores nothing. `SOURCE_TYPE_LABEL` decides how each one is spoken
and `SOURCE_TYPE_NOTE` says what it means in one line, shown beside the badge in the drawer.

This matters for honesty rather than style. The obligation of invariant 4 is that a reader can tell
which numbers are the study's and which the system invented. *Simulación operativa* discharges it
better than **DEMO**, which reads as a watermark on a sales demonstration and is therefore skimmed.

### 3. The eyebrow explains the datum, not the mechanism

`ETIQUETA DERIVADA DE LAS FACETAS` was true and useless: it described our implementation to someone
asking whether they may quote a figure. It is replaced by the badge's own note —
*Cifra verificable del expediente, sin datos identificables* — which answers the question they came
with. The four facets are still listed underneath, unchanged, for whoever wants the mechanism.

### 4. A test, because this leaks back on its own

`e2e/vocabulary.spec.ts` reads the text of every surface, the rail and the drawer, and fails on:

- **an identifier shape** — `SCREAMING_SNAKE_CASE` is never Spanish prose, so one on screen means
  some component is printing a stored value. The PGAS chapter renders a document full of capitals
  and no underscores, so the rule does not fight real content;
- **the English this product actually leaked**, as a denylist, so a regression names itself.

Codes a reader *wants* — `PPMI-01`, `QG-001`, `DOC-002`, `EPSG:32717`, `0+000` — carry no underscore
and are not in the denylist.

## Consequences

- The approved bundle and the product now differ in vocabulary. That is a **deliberate divergence
  from a visual reference on a matter the reference does not govern**: ARCHITECTURE §11a lets the
  bundle decide composition, hierarchy, treatment and interaction intent, and this changes none of
  them. It is recorded in `docs/DESIGN_BUNDLE_KNOWN_ISSUES.md` so a future reader comparing
  screenshots is not left to guess.
- The screenshots in `docs/screenshots/` are regenerated; the manual's wording follows.
- The demo fixture's own copy was part of the leak (`surfaceLabel: "Quality Gate"`, an activity
  event mentioning FieldFlow) and is corrected with the rest. A fixture writes the words a reviewer
  reads, so it is product copy, not test data.
- `docs/PRODUCT_LANGUAGE_ES.md` is the vocabulary a future surface follows.

## Alternatives rejected

**Keep the English module names as branding.** They are branding to the people who wrote them. To a
consultant in Zamora opening the rail, *Quality Gate* is a piece of untranslated software, and the
product's first job in this wave is to be understandable.

**Translate everything, including the badge, and drop the four categories.** The categories are
invariant 13 and carry the provenance contract; renaming a label is not the same as removing a
distinction, and the derivation is untouched.

**A full i18n framework with message catalogues and a locale switch.** There is one locale, and the
product's problem today is the words, not the plumbing. Constants beside the types they label are
where a developer will actually look; a catalogue can wrap them the day a second locale exists.

**Leave the fixture in English because it is test data.** It is not: it is the copy a reviewer reads
on the Command Center.
