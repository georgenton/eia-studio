# Production V1 — the road to 15 October 2026

> The commercial project is approved: **eight rural-road projects**, in production, with an
> operational go-live of **15 October 2026**. This page is the honest state of that: what exists,
> what Wave 1 added, and what still stands between here and a production deployment.
>
> Nothing here authorises a production deploy. Production remains manual and gated
> (`docs/DEPLOYMENT.md` §6, CLAUDE.md rule 20).

## 1. What Wave 1 delivered

**EIA Field**, a first-party Android/iOS application for offline capture, and the server half that
makes it safe (ADR-028). The invariant it was built to satisfy:

> sign in → download → lose all connectivity → close and reopen → capture → submit on the device →
> reconnect → synchronise → the same work appears in EIA Studio → synchronise again → **zero
> duplicates**.

`field.surveys.offline_mode = required` is now a policy a project can actually set: `EIA_FIELD_MOBILE`
is the first capture channel that declares `supportsOffline: true`, and it earns the claim.

## 2. What is *not* done, and is needed before eight real projects run on this

These are the honest blockers, in the order they block.

| # | Blocker | Why it blocks | Owner |
|---|---|---|---|
| 1 | **The compliance review** (SECURITY.md §10a) | Eight real projects means real households answering real questionnaires. Until the LOPDP review passes, this product's own rule is that data stays synthetic, anonymised or aggregated | owner + counsel |
| 2 | **Native builds and distribution** | Wave 1 verified the JavaScript bundle for both platforms and generated no signed artefact. Android and iOS development builds need a machine with the SDKs; distribution needs Apple and Google accounts, which are paid actions nobody has authorised | owner |
| 3 | **Field media** | Photographs are evidence in an EIA, and there is no `Media` table, no storage adapter and no object-storage credential (TD-037). A camera button that cannot upload is worse than none | owner (storage) → dev |
| 4 | **Production hosting and recovery** | Staging's database has no backups and no point-in-time recovery, and is explicitly disposable (`docs/DEPLOYMENT.md` §4b). Production cannot inherit that | owner + dev |
| 5 | **A second project** | The profile mechanism has run one project. Eight will find what is pilot-shaped in it — the fastest way to know is the second one | dev |
| 6 | **A correction workflow** | A submitted response is immutable by design. Eight projects will produce corrections, and there is no reviewed path for one (TD-060 is the same gap for reports) | dev |
| 7 | **Real device testing at distance** | `docs/FIELD_MOBILE_OFFLINE_UAT.md` is reproducible and has not been run on a handset in a corridor with no signal. That is a field test, not a laboratory one | owner + dev |

## 3. What Wave 1 deliberately left alone

Bilingual rollout, project intake, document upload, AI document review and template generation are
Wave 2/3. None was started.

## 4. Where the go-live date actually sits

The offline pipeline — the part that could not be bought and could not be faked — is built and
tested. What remains between it and eight production projects is mostly **not engineering**: a
compliance review, two developer accounts, a storage decision and a hosting decision.

Items 1, 2 and 4 of §2 are decisions somebody has to make, and each has a lead time this product
does not control. The date is achievable for the capture pipeline; it is the owner's call whether it
is achievable for everything around it, and that call is better made against this list than against
a summary.
