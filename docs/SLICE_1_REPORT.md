# Slice 1 — product shell, project workspace and historical Command Center

> What was built, what was deliberately left out, and where the implementation departs from the
> approved design bundle and why. Read with `design/reference/claude-design-v0.2/README.md`
> (contract) and `docs/DEMO_ZAMORA.md` (what is real and what is a demo simulation).

## 1. The journey this slice delivers

```
sign in → Portfolio → choose an authorized project → workspace shell
        → Command Center → open a figure's provenance
```

Every step uses the real machinery: Better Auth for identity only, the domain `RequestContext`
built from the URL and verified against memberships, tenant and project roles, the permission
catalogue and the capability resolver. No component receives an authorization decision from the
client, and no screen reads a hardcoded project.

## 2. Surfaces

| Surface | Route | State |
|---|---|---|
| Sign in | `/sign-in` | Built. No registration, no password reset, no email delivery: public self-signup stays disabled (IG0-H01). |
| Entry | `/` | Redirects to the single tenant, offers a choice when there are several, states the empty case. |
| Portfolio | `/t/[tenant]` | Built. |
| Command Center | `/t/[tenant]/p/[project]` | Built. |
| GIS, Field, Social, Quality, Documents, Reports | `/t/[tenant]/p/[project]/[surface]` | **Capability-guarded placeholder.** Not an implementation of those modules: no module data, no module actions. `requireCapability` runs server-side, so a disabled capability yields `feature disabled` even when the URL is typed by hand. |

## 3. Data model

Five tables in `app`, all project-scoped, all with `ENABLE` + `FORCE` RLS and policies based on
`has_project_access` (migrations `0005` and `0006`).

| Table | Holds |
|---|---|
| `provenance_record` | Faceted provenance: regime, origin, ordered transformations, granularity, source labels, method, capture and validation state. No `source_type` column exists anywhere. |
| `provenance_input` | Lineage edges: a derived record names what it was calculated from. |
| `metric_snapshot` | One measured value of one metric from a **database enum** of ten known metrics; `numeric_value` and `date_value` are mutually exclusive by a check constraint; `provenance_id` is `NOT NULL`. |
| `forecast_snapshot` | The deterministic forecast with its inputs, window, assumptions, algorithm version and result. |
| `attention_item`, `activity_event` | The curated "Requiere atención hoy" queue and the activity feed. |

`metric_snapshot` is a typed measurement entity rather than a generic key/value table: the key is
a closed PostgreSQL enum, each key has a fixed meaning, unit and value kind in
`packages/domain/src/projects/metrics.ts`, and an invented key is rejected by the database.

## 4. Provenance

Canonical provenance is faceted (ADR-005, D-013) and is stored as columns:

- **regime** `HISTORICAL_OBSERVED` · `LIVE_OPERATIONAL` · `DEMO_SIMULATION`
- **origin** `FIELD_CAPTURE` · `IMPORTED_DOCUMENT` · `IMPORTED_DATASET` · `SYSTEM_GENERATED`
- **transformations** ordered array of `ORIGINAL` · `RECONSTRUCTED` · `DERIVED` · `ANONYMIZED`
- **granularity** `INDIVIDUAL` · `AGGREGATE` (nullable where it does not apply)

The four v0.2 SOURCE TYPE badges are derived at render time by `deriveSourceTypeLabel` in
`@eia/ui` and are labelled in the drawer as *"etiqueta derivada de las facetas"*, so a reader is
never led to believe a source type was stored.

**No traceability is manufactured.** The historical aggregates state truthfully that they were
loaded as an approved fixture and that the project's document corpus has not been ingested by the
Documents module, so there is no page locator to point at. That sentence is in the fixture and is
shown in the drawer.

## 5. Historical facts versus demo simulation

The four approved historical aggregates carry regime `HISTORICAL_OBSERVED`, origin
`IMPORTED_DOCUMENT`, transformation `[ORIGINAL]`, granularity `AGGREGATE`, and therefore render
the `REAL_AGGREGATE` badge:

| Fact | Where it appears |
|---|---|
| corridor length | project header |
| roadside parcels | KPI "Universo estimado" |
| socioeconomic surveys | KPI "Encuestas completas" |
| consultation participants | "Consulta significativa" card |

Everything else on the Command Center is `DEMO_SIMULATION` and renders `SYNTHETIC`, under a
block-level `DEMO / SYNTHETIC` badge on the KPI panel and a `DEMO` badge on the activity feed.
A reviewer sees the two regimes side by side in the same strip, each with its own badge and its
own "Ver origen" link.

## 6. Operational forecast

`pendientes ÷ media móvil de N días = días restantes`, then `cierre proyectado = fecha de cálculo
+ días restantes`. It is arithmetic, stated as arithmetic ("cálculo aritmético sobre el ritmo
observado · sin modelo predictivo"), with the algorithm version rendered on the panel. The stored
snapshot carries the inputs and assumptions, so the number can be recomputed by hand.

**Deviation from the prototype, deliberate.** The prototype shows 22 pending at 5,2 per day and a
*4-day* projected delay against a target 23 days away. Those figures do not follow from the
formula the same prototype states: 22 ÷ 5,2 is five days of work, and the prototype's own
"ritmo necesario 7,3" implies a target three days out, which gives a **2-day** delay. Invariant 5
requires the number to be reproducible, so the implementation seeds the coherent inputs and shows
what the algorithm computes: rate 5,2 · required 7,3 · projected 22 sep · **2 días** of delay.
The composition, the wording and the "retraso proyectado" chip are unchanged.

## 7. Deviations from the approved design

| Design element | What was done | Why |
|---|---|---|
| Command Center "Resumen territorial" | **Omitted** | It is a map, and every map must carry the state and layer-provenance legends. That is the GIS module, which this slice must not implement. |
| Command Center "Instrumentos del proyecto" | **Omitted** | Instrument counts are Field Surveys data. Inventing them would fabricate a historical metric. |
| Portfolio card "HALLAZGOS 7" | **Omitted** | Quality Gate data. |
| "Requiere atención hoy" row actions | Row navigates only when its target surface exists in this slice; otherwise it offers "Ver origen" | The design has every row navigate. Linking to a route that does not exist would be worse than saying where the item lives. |
| Forecast projected delay | 2 days, computed | §6. |
| Command palette (⌘K) | **Not built** | It is navigation sugar over routes that mostly do not exist yet; it belongs with the surfaces it would reach. |
| Topbar search | **Not built** | Same reason: there is nothing to search yet. |
| Tenant Settings | Rail placeholder only | Out of scope for this slice. |
| Per-KPI provenance badge and link | Added (the design has one "Ver origen" for the whole strip) | Invariant 4 asks every datum to carry its source type, and the strip deliberately mixes two regimes. |

An explicit panel on the Command Center, "Alcance de esta fase", tells the reader that the
territorial summary, the project instruments and the quality findings arrive with their modules
and that no invented figures stand in for them.

## 8. Visual comparison with the golden references

Implementation screenshots at 1440 px are committed under `docs/screenshots/slice-1/` and are our
regression baseline from here on. They are not compared pixel-for-pixel with the bundle: the
captures are a fidelity reference for hierarchy, spacing, typography and density, not a pixel
specification.

| Aspect | Assessment against `01-portfolio.png` and `02-command-center.png` |
|---|---|
| Hierarchy | Matches: serif screen title, panel labels in 9,5 px uppercase with tracking, serif figures. |
| KPI strip | Matches: one panel with hairline separators, eight cells in a single row at 1440 px, not eight cards. |
| Typography | Matches: Source Serif 4, Archivo and JetBrains Mono, self-hosted via `next/font`. |
| Density and whitespace | Close: panel padding, 36 px table rows, restrained radii. |
| Navigation | Matches: rail with organisation and project switchers, workspace group, ANNOUNCED items as non-navigable placeholders with "FASE 3". |
| Colour | Matches: technical blue, terracotta for the projected close and pending count, amber for revisits, the solid `DEMO / SYNTHETIC` badge. |
| Provenance drawer | Matches the 420 px right drawer with overlay; content is richer than the prototype because the facets are shown as facets. |
| Right column of the Command Center | Shorter than the reference, by §7. |

## 9. Accessibility baseline

Semantic landmarks (`nav`, `main`, `header`), a skip link, `aria-current` on the active rail item,
labelled form controls and switchers, visible focus rings on every interactive element, a
`role="dialog"` drawer with `aria-modal`, focus moved to its close button on open, a Tab trap,
Escape to close and focus returned to the invoking element, `role="progressbar"` with values on
the progress bar, a text alternative on the forecast chart, and severity communicated by a dot
**and** a text label rather than colour alone.

Not done: an automated axe pass, and a full keyboard walkthrough of the switchers under a screen
reader. Recorded as TD-022.

## 10. What this slice does not do

No GIS, no map, no geometry, no parcels, no FieldFlow, no surveys, no AI coding, no taxonomy, no
Quality Gate, no RAG, no reports, no Client Portal, no climate, no PMA compliance, no
environmental audit. TanStack was not installed: the surfaces are Server Components and the only
client components are the two switchers, the sign-in form and the drawer shell.
