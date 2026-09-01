# Design System — extraction from the approved bundle

> Purpose: prepare reusable production components that preserve the approved behaviour and visual
> language of "Dirección B — Institucional" **without copying generated HTML**. Screenshot pixel
> values are references, not CSS constants (README: a 362 px panel is not `width: 362px`).
> Normative values come from the README token tables and spec v0.2 §11–§13.

## 1. Tokens

Tokens are the only place where hex values, font sizes and spacing appear in production code.
Proposed home: `packages/ui/tokens/` (CSS custom properties + a typed TS export).

### 1.1 Colour (semantic, from README "Design Tokens")

| Token | Value | Role |
|---|---|---|
| `--ink` | `#101827` | primary text, portal top bar |
| `--accent` | `#17506B` | action, selection, brand ("azul técnico") |
| `--accent-hover` | `#0E3A50` | primary button hover |
| `--accent-soft` | `#F0F6F9` | active background, info notices, AI suggestion container |
| `--accent-border` | `#C3D6E0` | border of informational containers |
| `--map-blue` | `#4A7F9B` | data series and coverage |
| `--ok` / `--ok-bg` / `--ok-border` | `#2C6046` / `#EAF3EE` / `#CBE2D6` | complete, validated, approved |
| `--warn` / `--warn-text` / `--warn-bg` / `--warn-border` | `#B08519` / `#8A6512` / `#FBF3E2` / `#EFE0BF` | revisit, low confidence, fixable gap |
| `--crit` / `--crit-text` / `--crit-bg` / `--crit-border` | `#C0492A` / `#9E3B22` / `#FBEAE6` / `#F0D3CB` | critical finding, error, inconsistency |
| `--surface` | `#FFFFFF` | cards, tables, panels |
| `--canvas` | `#F2F4F5` | workspace background |
| `--surface-subtle` | `#FAFBFC` | table headers, quotes |
| `--border` | `#DCE1E5` | container outline |
| `--border-strong` | `#C8D0D6` | secondary button, quote rules |
| `--hairline` | `#F0F2F4` | row separators |
| `--chip-neutral` / `--chip-neutral-border` | `#F1F3F5` / `#E2E6E9` | neutral chip |
| `--text-secondary` | `#5A646C` | secondary body |
| `--text-muted` | `#7A858E` | labels and metadata |
| `--text-disabled` | `#A6AEB4` | non-actionable |
| `--demo` | `#8A6512` on white text | DEMO / SYNTHETIC badge |
| `--overlay` | `rgba(16,24,39,.28)` drawer · `rgba(16,24,39,.35)` palette | overlays |

Rule (spec §12): colour encodes state, never decorates. No state relies on colour alone — a glyph,
a label, or both always accompany it.

### 1.2 Typography

Three families: **Source Serif 4** (headings, project names, figures, every literal quote),
**Archivo** (interface), **JetBrains Mono** (codes, abscissas, coordinates, capability keys,
model scores, rule ids, timestamps).

| Style token | Size / line | Weight |
|---|---|---|
| `display` | 38 / 44 | 600 |
| `title-screen` | 23–26 / 32 | 600 |
| `title-card` | 17 / 24 | 600 |
| `figure` | 20–44 | 600 |
| `quote` | 14–17 / 1.65 | 400 |
| `body` | 12.5 / 19 | 400 |
| `label` | 9.5 / 14, tracking .12em, uppercase | 600 |
| `mono` | 10.5–11 / 16 | 400–500 |

Fonts are loaded from Google Fonts in the prototype; production should self-host them (privacy,
offline field use) with real fallback stacks.

### 1.3 Spacing, radius, elevation

- Spacing scale: `4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 26 · 32 · 44`.
- Page padding `20–28px / 26–32px`; card padding `14–20px`; table cell `9–12px 16px`.
- Radii: `3px` (square chips, badges, rail controls) · `4px` (buttons, inputs, inner containers) ·
  `5px` (panels) · `6px` (portal, palette) · `11–13px` (rounded chips) · `50%` (avatars, dots).
- Shadows: card `0 1px 2px rgba(16,24,39,.04)` · palette `0 18px 44px rgba(16,24,39,.22)` ·
  drawer `-14px 0 34px rgba(16,24,39,.14)`.
- Table row ≈ 36px, hover `#FBFCFD`, no zebra striping, selected row = `--accent-soft` background
  + `2px` left border in `--accent`.

## 2. Component families

Grouped by the module that owns them. Names are proposals for `packages/ui`.

### 2.1 Shell (core)

- `AppShell`: sticky left rail (~244 px reference) + sticky 52 px topbar + canvas. The rail never
  collapses on internal surfaces, including GIS (spec decision 01).
- `TenantSwitcher` (label "ORGANIZACIÓN", avatar, name, caret) and `ProjectSwitcher`
  (label "PROYECTO ACTIVO", soft-blue box). Both are **context selectors that navigate**, they do
  not mutate a global; the URL carries the context (see TENANCY.md).
- `NavRail` items with optional mono numeric badge (counts) and a presentation state
  ACTIVE / ANNOUNCED / HIDDEN (prototype shows "Reports · FASE 3" as ANNOUNCED: a non-navigable
  placeholder for a capability that is disabled for authorization, D-014), plus an external-link
  glyph for the Client Portal item.
- `Topbar`: breadcrumb `tenant › context`, global search field with `⌘K` chip, notification dot,
  user avatar + name + role label.
- `CommandPalette`: ⌘K / Ctrl+K, Esc closes, list of destinations with mnemonic chords
  (`G P`, `G D`, `G G`, `G S`, `G Q`, `G T`, `G C`, `G E`) plus object search (parcel, document,
  section).

### 2.2 Data display

- `DataTable`: dense 36 px rows, hairline separators, header on `--surface-subtle`, single
  selection model, row click navigates or selects, mono for codes and dates.
- `KpiStrip`: one panel, `repeat(n, 1fr)` grid with `1px` gaps over `#EDF1F3` (hairlines, not
  cards). Cell = label / serif figure / note. Header slot for the DEMO badge + "Ver origen" link.
- `StatCounters`: five-cell counter strip (Quality Gate).
- `FigureBlock`: serif number + caption (portal, parcel summary).
- `ProgressBar`: 7 px bar in `--accent` (project), thin variant per sector.
- `PaceBars`: 10-day bar series; last 5 in `--accent`, previous in `#B8CBD6`.
- `FrequencyTable`: category / n / % / distribution bar, with base note (`n = 119 · no ponderado`).
- `CrossTab`: category × segment.
- `Timeline` (visits; portal milestones with done / current / next states).
- `ActivityFeed` table (time / actor / action / object).

### 2.3 Status and semantics

- `StatusChip`: variants ok / progress / warn / crit / neutral; always text, optional glyph.
- `ParcelStateChip` and map polygon style share one definition table (colour + glyph):

  | State | Glyph | Fill | Stroke |
  |---|---|---|---|
  | Completo | `✓` | `#DCEDE3` | `#2C6046` |
  | Visitado | `◐` | `#DCE6EA` | `#4A7F9B` |
  | Pendiente | `○` | `#F1F3F5` | `#A6AEB4` |
  | Requiere revisita | `↻` | `#FBF3E2` | `#B08519` |
  | Inconsistencia | `!` | `#FBEAE6` | `#C0492A` |
  | No localizado | `?` | `#FFFFFF` | `#8B959C` |

- `InstrumentMark`: compact `✓ ◐ —` inside tables.
- `InstrumentStateChip`: NOT STARTED · IN PROGRESS · COMPLETE · NEEDS REVIEW · VALIDATED.
- `SeverityTag`: dot **and** label (Alta `#C0492A`, Media `#B08519`, Baja `#8B959C`).
- `FindingStateChip`: OPEN · REVIEWING · ACCEPTED · DISMISSED · RESOLVED.
- `SourceTypeBadge`: REAL_AGGREGATE (green) · RECONSTRUCTED (amber) · ANONYMIZED (blue) ·
  SYNTHETIC (neutral). These four labels are a **presentation mapping** derived from the
  faceted provenance record (regime, origin, transformations, granularity) by a table in
  `packages/ui`; they are not a backend enum (PROVENANCE.md §2.6, D-013). The drawer shows the
  raw facets beneath the label.
- `DemoBadge`: `DEMO / SYNTHETIC`, `DEMO`, `DEMO · ANONIMIZADO`.
- `ConfidenceChip`: CONFIANZA ALTA (green) / MEDIA (blue) / BAJA (amber) always next to
  `model score 0,86` in mono.
- `GpsStatusChip`: GPS OK · SIN GPS · PEND. SYNC.
- `FieldInboxStateChip`: FALTA FOTO · GPS ALEJADO · PENDIENTE SYNC · LISTO PARA VALIDAR.

### 2.4 Overlays and layout

- `Drawer` (right, ~420 px reference, overlay, close by overlay / × / Esc). The only drawer in v0.2
  is `ProvenanceDrawer` (see below), but the component is generic.
- `SplitView`: primary area + contextual side panel (GIS: map+table / 302 px panel; Parcel: 1fr /
  300 px; Social queue: 290 px list / centre / right column). Proportions are references.
- `ListDetail`: in-place detail with "← Volver a la bandeja" (Quality Gate), not a modal.
- `Tabs` (underline style, accent when active): Tenant Settings (7), Parcel (6), Social (3).
- Rule: no modals for everything — drawers, split views and contextual panels before dialogs.

### 2.5 Provenance (cross-cutting)

- `ProvenanceLink`: 11 px `--accent` 500 "Ver origen" text link. Never a permanent block.
- `ProvenanceDrawer` fields: SOURCE TYPE (+ contextual note) · SOURCE / DATASET · VERSIÓN ·
  CAPTURADO / IMPORTADO · MÉTODO (derived only) · HUMAN VALIDATION (status, author, date) ·
  actions "Abrir dataset" / "Ver registros base".
- Invocation points in v0.2: KPI strip, forecast, consultation figure, map layer, parcel panel,
  parcel instruments, closed variable, open answer, finding detail. Future: generated report.

### 2.6 GIS

- `MapView` (MapLibre in production): base map, corridor/alignment layer, parcel polygon layer
  with state style + glyph label, abscissa ticks, place labels, zoom / fit / layer controls
  (top-right stack), `ParcelStateLegend` (top-left, with counts) and the **mandatory**
  `LayerProvenanceLegend` (REAL BASE MAP · RECONSTRUCTED ALIGNMENT · SYNTHETIC PARCELS, with
  "Ver origen de la capa"). Legend is mandatory on every cartographic representation, including
  the Command Center thumbnail (`CorridorThumbnail`).
- `FilterBar`: search, sector, state (multi), instrument, quality; count, "Fit bounds",
  "Exportar selección".
- `ParcelContextPanel`: selected parcel header (mono code, SYNTHETIC badge), sketch, facts,
  instruments, CTA "Abrir Parcel Workspace", "Ver origen de los datos".
- Selection is a single shared state between map, table and panel (invariant 6).

### 2.7 Social Intelligence (HITL)

- `ImmutableSourceBlock`: header `IMMUTABLE SOURCE` + note, serif quote on a 3 px grey rule,
  mono metadata (id, parcel, date, instrument), "Ver origen".
- `AiSuggestionCard`: bordered `--accent-border` container, header on `#F7FAFC`, `AI SUGGESTED`
  badge, category / subcategory / rationale, `model score` + `ConfidenceChip`; low-confidence
  variant shows an amber notice and **does not preselect** a category (state 15) and may list
  candidate categories with their scores.
- `ReviewActions`: Aceptar `A` · Modificar `M` · Nueva categoría `N` · Rechazar `R`;
  keyboard `J`/`K` navigate, `S` = second opinion. Note: the prototype wires only `J`, `K`, `A`.
- `CodingQueue` list with filters (sin revisar · confianza baja · desacuerdo · validadas), batch
  mode footer, session progress panel, current-taxonomy panel.
- `CategoryProposalBanner`: `PROPUESTA` badge, "Revisar las N" / "Descartar".

### 2.8 Quality Gate

- `FindingRow` (title + subtitle, mono type, severity tag, source, state chip, assignee, date).
- `FindingDetail`: header (id, severity, state, type, "Ver origen"), serif title, explanation,
  `SourceCard` A / B (document, section, reference, literal quote in serif on a rule, "Abrir
  documento en el visor"), `WhyFlagged` (reasoning + `rule.*` id chip + detection date),
  `SuggestedAction`, `SpecialistDecision` (mandatory justification textarea, Aceptar / Descartar
  / Resolver / Reasignar).

### 2.9 Client Portal (separate surface)

Own chrome: dark top bar (`--ink`) with `VISTA CLIENTE` badge and "Acceso de solo lectura ·
información agregada", institutional eyebrow, serif 30 title, "Descargar resumen PDF", 1080 px
reading width, overall progress (serif 44 + chip + bar + four aggregate figures), milestones
timeline, sectors by segment, upcoming deliverables, recent field activities, closing legal note.
It shares tokens and primitive components with the workspace but **not** layout or data hooks.

### 2.10 System states (15)

`loading` · `empty` · `error` · `offline` · `syncing` · `permission denied` · `feature disabled`
· `no project selected` · `no GIS yet` · `partial GIS` · `no survey data yet` · `offline pending
sync` · `no findings` · `AI unavailable` · `AI low confidence`.

Rules: applied to the container where the problem occurs, never the full screen; loading
skeletons take the shape of the real content; unsynced records do not count toward progress and
the UI says so; `no findings` states that it does not replace technical review; `AI low
confidence` never preselects. Definitive copy is in the prototype gallery. Proposed
implementation: a `StateContainer` primitive with one sub-component per state, each with its
approved copy in the message catalogue and a Storybook story used for visual regression.

## 3. Interaction patterns to preserve

1. Navigation targets are identical from rail, breadcrumb and command palette (routes).
2. Every "Requiere atención hoy" row navigates to the surface where the problem lives.
3. GIS row ↔ polygon ↔ panel single selection.
4. Queue: `A` accepts and advances, the accepted answer becomes `VALIDADA`, session counter
   increments (persisted mutation in production).
5. Quality Gate list → detail in the same surface with back link.
6. Provenance drawer opens from any "Ver origen", closes by overlay / × / Esc.
7. Hover: rows `#FBFCFD` or `#F7FAFC`, secondary buttons `#F4F6F7`, primary `--accent-hover`.
8. Desktop-first for management, analytics, documents, GIS; tablet for technical work; mobile only
   for FieldFlow and quick queries (later).

## 4. What not to do

- Do not reproduce the prototype's inline styles; encode them as tokens and components.
- Do not hardcode screenshot widths; use the proportions as layout intent.
- Do not invent a dark theme; the approved direction is a single light institutional look.
- Do not add padlocks or greyed-out entries for disabled capabilities.
- Do not present a model score as a probability, anywhere in copy or tooltips.

## 5. Golden references

The 11 screenshots (1440 px wide) become visual regression baselines for the corresponding
production routes once those routes exist, with masked dynamic regions and a perceptual tolerance
(see TESTING_STRATEGY.md). They are never a source of numeric CSS.
