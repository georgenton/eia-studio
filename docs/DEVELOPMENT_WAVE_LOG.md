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
| Merge SHA | `7072e88` |
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

### Slice 5 — Quality Gate

| | |
|---|---|
| Branch / PR | `feat/slice-5-quality-gate` · (recorded at merge) |
| Merge SHA | *(recorded at merge)* |
| Migrations | `0018_quality_gate_tables.sql` (5 tables), `0019_quality_rls_and_invariants.sql` (grants, RLS, CHECKs, append-only and two-source triggers) — forward only, additive, no backfill |
| Tests | unit **243**, integration **285**, Playwright **118**, staging (non-destructive) **70** |
| Staging | migrations 18 → 20 applied forward; 8 corpus assertions and 1 provenance record added; **every pre-existing id identical**; field baseline unchanged; verification suite 70 passed |
| External configuration | unchanged — this slice calls no model at all |

**Scope delivered.** Five deterministic rules over the concluded study's corpus; findings with two
sources of equal weight; a reviewer's decision with a mandatory justification, append-only; the
Quality Gate surface and the finding detail; an operator command (`pnpm quality:run`); manual page
07 and the walkthrough's reviewer leg.

**Meaningful decisions.** ADR-020: the rule catalogue is versioned code rather than a
`RequirementVersion` table with a `definition jsonb`, which amends ADR-008 §1. Two rules were
implemented differently from the brief's literal description, both for reasons of truthfulness:
QG-001 compares two documents rather than a document against the synthetic parcel layer, and QG-004
compares two documents rather than a legal conclusion against survey records — the latter would have
required special-category personal data the demo questionnaire is built not to collect.

**A defect found in our own posture.** The append-only grant on `specialist_review` was silently
absent: migration 0002's `ALTER DEFAULT PRIVILEGES` grants full DML on every new `app` table, so a
narrower `GRANT` beside it changes nothing. The isolation test caught it by asserting an error and
getting a successful no-op. Fixed with an explicit `REVOKE`, and staging now asserts the privilege
bits directly.

**Deviations.** Recorded in `docs/SLICE_5_REPORT.md` §9. Nothing outside the approved scope.

**Debt recorded.** TD-050 … TD-054.

