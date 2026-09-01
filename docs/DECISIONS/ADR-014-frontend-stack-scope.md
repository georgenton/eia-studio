# ADR-014 — Frontend stack scope: Next.js App Router plus selective TanStack libraries

- Status: Accepted (delivery alignment after Gate 1)
- Date: 2026-09-01
- Related: ARCHITECTURE.md §4 and §9, DESIGN_SYSTEM.md, IMPLEMENTATION_PLAN.md

## Context

Next.js is the approved React framework and router. The delivery review considered the TanStack
ecosystem: Router/Start (framework-level), Table (headless grids), Query (remote state), Virtual
(virtualised lists), Form (forms). The product has dense operational tables (GIS explorer, Field
inbox, Quality Gate, taxonomy), polling and optimistic mutations (coding queue, sync states), and
large forms later (survey templates, instruments).

## Decision

1. **Next.js App Router remains the framework and router.** TanStack Router and TanStack Start
   are **not** introduced; routes, layouts, server actions and route handlers stay in Next.js.
2. **Approved selective usage**, each added only in the slice that needs it:
   - **TanStack Table** for operational data grids (GIS parcel table, Field inbox, Quality Gate
     list, taxonomy table, membership tables) — introduced in the first slice with a dense grid
     (Slice 0 Tenant Settings tables may use plain markup; Slice 2 GIS table is the first real
     need).
   - **TanStack Query** for client-heavy remote state: polling of sync/run progress, refetching
     after mutations, optimistic updates in the coding queue and the GIS selection panel —
     introduced when the first such surface lands (Slice 3/4); server-rendered reads keep using
     Next.js server components and server actions.
   - **TanStack Virtual** only when demonstrated volumes require it (e.g. parcel tables beyond a
     few thousand rows, batch coding of 1,000 answers); not before a measurement shows the need.
   - **TanStack Form**: evaluate during the Field/Survey slice against React Hook Form and plain
     server-action forms; decision recorded then.
3. **Slice 0 installs none of the TanStack packages** unless the Tenant Settings tables prove
   to need Table; the default is plain components from `packages/ui`.
4. Server-state ownership: server components and server actions are the default; TanStack Query
   wraps only client-interactive state and never bypasses the `RequestContext`-scoped server
   entry points.

## Consequences

- Fewer client-side abstractions in early slices; grids and queries are added deliberately with
  a stated need.
- Two data-fetching styles coexist (server components vs Query on the client); the rule in point
  4 keeps them from overlapping.
- Any proposal to adopt TanStack Router/Start later requires a new ADR with a migration plan.

## Alternatives rejected

- Full TanStack ecosystem in Slice 0: unused dependencies, two routers' worth of concepts.
- AG Grid / commercial grids: licensing and styling conflicts with the approved design system.
