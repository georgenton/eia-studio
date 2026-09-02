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
| GIS, Field, Social, Quality, Documents, Reports | `/t/[tenant]/p/[project]/[surface]` | **Capability-guarded, one policy (ADR-016).** A capability the project is not entitled to answers **404**; one it *is* entitled to whose surface is unbuilt shows an inert state. Neither implements the module: no module data, no module actions. |

## 2a. Capability route policy (ADR-016, IG1-001)

Route behaviour follows the **effective capability** and nothing else, resolved in one place —
`apps/web/lib/surface-access.ts`. No page re-derives the rule.

| Effective capability | Surface built | Route answers |
|---|---|---|
| `false` (product, tenant, project, dependency, or ANNOUNCED) | — | **404**, identical to a URL that means nothing |
| `true` | yes | the surface |
| `true` | not yet | *"Módulo habilitado para este proyecto. La implementación aún no está disponible."* — inert: no data, no actions, no claim the workflow exists |

The 404 is the point: the `feature disabled` copy names the capability key and who can enable it,
so serving it at a route let anyone who guesses a URL read another party's configuration. That
state keeps its place inside surfaces the user may already see and in the settings surfaces.
Navigation presentation cannot widen any of this — an ANNOUNCED module is `effective = false`, so
its route is 404 however the rail chooses to show it.

Covered by `packages/domain/test/workspace.test.ts` (the three outcomes as a pure function),
`packages/application/test/command-center.integration.test.ts` (the server refuses before it
reads, including a capability the tenant switched off), and `e2e/authorization.spec.ts` (404 with
no capability key in the body, indistinguishable from a nonsense segment; the probe endpoint
behaves the same; the unbuilt surface answers 200 with the inert state and exactly one link).

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

**It is not the analytics store (IG1-002).** It is a curated projection for one purpose: the
figures a coordinator reads at a glance. Every module keeps its canonical model — parcels and
affectations in `gis`, visits and answers in `field`, codings in `social`, findings in `quality` —
and *projects* a selected output here when the Command Center needs it. Three things hold the
boundary: the database enum, a test that pins the exact curated set and asserts module-owned
measurements are not valid keys, and the rule written above the vocabulary. Full statement in
`docs/DATA_MODEL.md` §3.1.

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

## 5a. The demo scenario clock (IG1-003, IG1-008)

A demo shown in six months has to produce the figures approved today, so the simulation has an
explicit clock rather than a relationship with "now":

- the clock lives on the calculation it anchors — `forecast_snapshot.as_of_date` — and **not** on
  `Project`, which is a real consulting engagement and carries no demonstration state (IG1-009).
  A demo forecast's anchor *is* the scenario; its provenance regime says which kind it is, and
  `demoScenarioDate(forecast, provenance)` is the whole rule. There is no scenario table and no
  scenario subsystem;
- the fixture states it once (`demoScenario.scenarioDate`) and it stays fixture metadata: at seed
  time it becomes persisted timestamps on the rows that own them — the forecast's `as_of_date` and
  `calculated_at`, the activity feed's `occurred_at`, and the capture instant of the demo
  provenance records, whose events are day offsets rather than dates;
- the UI names it where it matters — *"Escenario demo · fecha de corte: 17 sep 2026"* on the KPI
  panel and the activity feed, and the header's "última actualización" becomes "fecha de corte del
  escenario". The value is read from the simulated forecast, never from the project;
- **historical facts do not inherit it.** An aggregate from the concluded study keeps its own
  capture date on its own provenance record. The two clocks live in different places precisely so
  they cannot merge.

`calculateForecast` takes `calculatedFrom` as an input and never reads the system clock. Tests
run it under four faked machine dates spanning 2020 to 2099, and across a year boundary, and
assert identical output; a further test asserts the module's source contains no `Date.now()` or
bare `new Date()`.

Five further assertions pin the arrangement: `app.project` has no column matching
`demo|scenario|simulation` and `forecast_snapshot.as_of_date` is `NOT NULL`; the project header
read model exposes no such field; a historical metric keeps its own capture date (2024) rather
than inheriting the scenario (2026); a project with no simulation returns a coherent view with a
null forecast; and `demoScenarioDate` returns null for a `LIVE_OPERATIONAL` or
`HISTORICAL_OBSERVED` forecast, so a real project never needs demo metadata.

## 6. Operational forecast

`pendientes ÷ media móvil de N días = días restantes`, then `cierre proyectado = fecha de cálculo
+ días restantes`. It is arithmetic, stated as arithmetic ("cálculo aritmético sobre el ritmo
observado · sin modelo predictivo"), with the algorithm version rendered on the panel. The stored
snapshot carries the inputs and assumptions, so the number can be recomputed by hand.

**Deviation from the prototype, accepted at Gate 1 (IG1-003).** The prototype shows 22 pending at
5,2 per day and a *4-day* projected delay. Those figures do not follow from the formula the same
prototype states: 22 ÷ 5,2 is five days of work, and the prototype's own "ritmo necesario 7,3"
implies a target three days out, which gives a **2-day** delay. A visual reference may not
override deterministic algorithm output (ARCHITECTURE.md §11a), so the implementation shows what
the algorithm computes: rate 5,2 · required 7,3 · projected 22 sep · **2 días**. The composition,
the wording and the "retraso proyectado" chip are unchanged. The prototype's 4 is recorded as
reference inconsistency #10 in `docs/DESIGN_BUNDLE_KNOWN_ISSUES.md`.

## 7. Deviations from the approved design

| Design element | What was done | Why |
|---|---|---|
| Command Center "Resumen territorial" | **Omitted** | It is a map, and every map must carry the state and layer-provenance legends. That is the GIS module, which this slice must not implement. |
| Command Center "Instrumentos del proyecto" | **Omitted** | Instrument counts are Field Surveys data. Inventing them would fabricate a historical metric. |
| Portfolio card "HALLAZGOS 7" | **Omitted** | Quality Gate data. |
| "Requiere atención hoy" row actions | Row navigates only when its target surface exists in this slice; otherwise it offers "Ver origen" | The design has every row navigate. Linking to a route that does not exist would be worse than saying where the item lives. |
| Forecast projected delay | 2 days, computed | §6. |
| `feature disabled` at a route | Replaced by 404 (ADR-016) | The state's copy discloses configuration; §2a. |
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

## 9. Accessibility

**By construction:** semantic landmarks (`nav`, `main`, `header`), a skip link, `aria-current` on
the active rail item, labelled form controls and switchers, visible focus rings on every
interactive element, a `role="dialog"` drawer with `aria-modal`, focus moved to its close button
on open, a Tab trap, Escape to close and focus returned to the invoking element,
`role="progressbar"` with values, a text alternative on the forecast chart, and severity
communicated by a dot **and** a text label rather than colour alone.

**Automated (IG1-005):** `e2e/accessibility.spec.ts` runs axe over four representative states —
sign-in, Portfolio, Command Center, and the Command Center with the drawer open — against the
WCAG 2.1 A/AA rule sets, failing the build on `serious` and `critical` violations. It runs in CI
in the `e2e` job.

It earned its place immediately: it found a genuine contrast defect. The approved palette's
"texto tenue" `#7A858E` is 3,77:1 on white, below AA for the 9,5 px uppercase labels the design
uses it for. The token is now `#6B747C` (4,76:1 on white, 4,59:1 on the subtle surface used by
table headers), the announced rail items read in it rather than in the decorative disabled grey,
and the highlighted forecast cell reads in the technical blue. The design bundle still specifies
the failing value, so the divergence is recorded in TD-025 for design v0.3.

**What this does not claim:** axe checks a minority of WCAG criteria. A green run is a regression
net, not evidence of conformance. No assistive-technology walkthrough has been done — that is what
remains of TD-022.

## 10. What this slice does not do

No GIS, no map, no geometry, no parcels, no FieldFlow, no surveys, no AI coding, no taxonomy, no
Quality Gate, no RAG, no reports, no Client Portal, no climate, no PMA compliance, no
environmental audit. TanStack was not installed: the surfaces are Server Components and the only
client components are the two switchers, the sign-in form and the drawer shell.
