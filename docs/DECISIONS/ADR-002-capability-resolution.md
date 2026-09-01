# ADR-002 — Centralised capability catalogue and resolution

- Status: Accepted with conditions at Gate 1 (decisions D-014 and D-020 applied)
- Date: 2026-09-01 (amended 2026-09-01 after Gate 1)
- Related: FEATURES.md, ADR-003, GATE-1.md

## Context

The product is organised in capabilities/modules (the 14 in the bundle; `field.offline_sync`
proposed by the phase brief is not added, see D-020). Invariant 2: navigation is governed by capabilities; a disabled module does
not appear (no greyed-out, no padlock). Two enablement levels exist (tenant › Módulos, project ›
Modules & Capabilities), a project can restrict but never widen. The prototype also shows an
entitled-but-not-yet-shipped module in the rail ("Reports · FASE 3") without an active route.
Hiding UI is not authorization; server actions, APIs and jobs must be protected.

## Decision

1. **One catalogue as code** (`core/capabilities/catalog.ts`) declaring, per key: module,
   dependencies, product status (`AVAILABLE`, `ANNOUNCED`, `EXTENSION`, `UNAVAILABLE`),
   surfaces (routes, nav item), enforcement points (actions, handlers, jobs), Spanish label/copy,
   who can enable it, and a shell-only navigation presentation hint. The catalogue holds exactly
   the 14 approved keys.
2. **One resolver, boolean result** (Gate 1 D-014): `effective = PRODUCT_AVAILABLE ∧
   TENANT_ENTITLED ∧ TENANT_ENABLED ∧ PROJECT_ENABLED ∧ dependencies effective`, computed once
   per request/job and stored in the context as a `CapabilitySet` of `enabled | disabled`. This
   boolean is the only value authorization consults.
3. **Navigation presentation is separate and non-authorizing**: `ACTIVE`, `ANNOUNCED`, `HIDDEN`,
   computed by the shell from catalogue status and tenant entitlement/toggle. An ANNOUNCED module
   is **disabled** for authorization: it is not invocable through URL, API, server action, job or
   command; the rail shows a non-navigable placeholder only. Pilot: Reports is ANNOUNCED;
   Climate, PMA and Environmental Audit are HIDDEN.
4. **Project overrides restrict only.** Enforced at write time (settings use-case rejects
   enabling a capability the tenant lacks) and at resolution time (AND), so a bad row cannot
   widen access.
5. **Enforcement everywhere**: `requireCapability(ctx, key)` in every server action, route
   handler and job handler; nav, palette and route table generated from the same set. A CI check
   compares the catalogue's enforcement points against the code registry.
6. **Capabilities are not configuration.** Behavioural parameters live in a separate typed
   configuration registry keyed by capability; reading configuration of a disabled capability is
   an error.

## Consequences

- Adding a capability = one catalogue entry + schema-registered configuration + enforcement in
  the module's entry points; no scattered booleans.
- Disabling never deletes data; objects become unavailable to navigation and mutation.
- The `feature disabled` state copy ("Este módulo es una extensión disponible para el perfil …
  Un Owner puede activarlo en Tenant Settings › Módulos") is generated from catalogue metadata.
- The ANNOUNCED presentation reproduces the prototype's "Reports · FASE 3" rail item. Gate 1
  confirmed it as a presentation-only state; authorization semantics remain boolean.
- `field.offline_sync` is **not** a capability (D-020). Whether offline behaviour is a capability
  or a configuration (`field.surveys.offline_mode = disabled | optional | required`) is an open
  decision recorded for the Field slice.

## Alternatives rejected

- Feature-flag service (LaunchDarkly-style) for modules: flags are per-environment rollout tools,
  not tenant/project entitlements with dependencies and copy.
- Storing the resolved set in the session/JWT: stale after toggles; must be per request.
- Per-component `if (enabled)` checks: hiding is not authorization.
- A tri-state resolver (`ENABLED / ANNOUNCED / HIDDEN`) used as authorization semantics: rejected
  at Gate 1 (D-014) because it mixes presentation with enforcement.
