# Development wave log

> One append-only entry per merged slice of the sustained MVP development wave authorised on
> 3 September 2026. It records what landed, what it cost, and what is still owed — including the
> things that are blocked on someone other than the code.
>
> Companion documents, not replacements: each slice keeps its own report (`docs/SLICE_N_REPORT.md`),
> its decisions live in ADRs, and its debt lives in `docs/TECH_DEBT.md`. This file is the timeline.

## Standing constraints for the wave

| | |
|---|---|
| Deployments | Preview only. Production has never been deployed; the `production` branch is untouched. |
| Persistent staging | Non-destructive verification only (`pnpm test:staging`). No resets, no truncation, no destructive integration run against it. |
| External AI | `LIVE_AI = BLOCKED_EXTERNAL_CONFIG` — no `AI_GATEWAY_API_KEY` in any environment (TD-049). Deterministic behaviour is built and tested regardless; no fake ever substitutes for a live provider in a persistent environment. |
| Data | Synthetic, PII-free demo data only. The compliance gate of SECURITY.md §10a is unopened. |

## Entries

### Slice 4 — Social Intelligence / human-in-the-loop

| | |
|---|---|
| Branch / PR | `feat/slice-4-social-intelligence` · [#7](https://github.com/georgenton/eia-studio/pull/7) |
| Merge SHA | *(recorded below at merge)* |
| Migrations | `0016_social_intelligence_tables.sql`, `0017_social_rls_and_invariants.sql` — forward only, already applied to staging before this wave began |
| Tests | unit **215**, integration **243**, Playwright **98**, staging (non-destructive) **57** |
| Staging | healthy; field baseline unchanged; snapshot identical before and after the verification suite |
| External configuration | `LIVE_AI = BLOCKED_EXTERNAL_CONFIG` (TD-049) |

**Scope delivered.** Deterministic closed-question tabulation with denominators declared in words;
a versioned, immutable coding taxonomy; classification runs and AI proposals; specialist review as
the validated result; the Social Intelligence surface. Plus, in this wave:

- **IG4-001 closed.** `SOCIAL_CLASSIFIER` no longer defaults to `fake`. One domain rule
  (`resolveClassifierAvailability`) decides for the web app, the worker and the operator scripts:
  the fake runs only in `local` and `test`, unset means unavailable rather than defaulted, a
  gateway without its credential is `BLOCKED_EXTERNAL_CONFIG`, and an environment name nobody
  anticipated counts as persistent. No run is written when nothing can process it; a worker with no
  usable classifier never constructs its consumer, so it never claims. Deterministic analytics are
  untouched, and no process refuses to boot over it.
- **UX-001 closed.** The topbar identity is a native `<details>` account menu with the signed-in
  address, the active role and `Cerrar sesión`. No role switcher: a role is a server-side
  membership, so changing it means signing in as someone else. Covered by `e2e/session.spec.ts`.
- **Internal manual started** at `docs/manual/`, pages 01–06 and 10 current, 07–09 marked not built.

**Meaningful decisions.** Availability is a *domain* concept rather than an environment-schema
refinement, because a missing credential must be a reported state and not a boot failure — a
staging deployment has to keep serving deterministic analytics. The environment schema was reduced
to shape validation accordingly. Environment classification fails closed: `local` and `test` are
named positively and everything else, including a typo, is persistent.

**Deviations.** None from the approved scope. The report's test totals were corrected before this
entry (Playwright 96 → 98 with the new session spec; unit 201 → 215; integration 240 → 243).

**Debt recorded.** TD-049 (no AI Gateway credential in any environment; owner decision). TD-041,
TD-042, TD-043, TD-044, TD-045, TD-046, TD-047, TD-048 remain open from the slice itself.
