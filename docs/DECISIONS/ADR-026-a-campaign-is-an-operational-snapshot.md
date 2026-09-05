# ADR-026 — A campaign is an operational snapshot, and the current one is the scope

- Status: Accepted
- Date: 5 September 2026
- Related: ADR-018 (offline capture is configuration), ADR-019 (rules calculate, AI proposes, a
  human validates), ADR-022 (the report snapshot), TD-039 (tabulation is per survey version),
  `docs/ZAMORA_WORKSPACE.md`.

## Context

A fixture revision changed which parcels the pilot's demonstration campaign should cover: the
twelve assignments moved from the first few hundred metres of the corridor to a spread along its
whole length. The seeder's rule is that re-seeding **fills gaps and never re-does work**, because an
assignment may carry a submitted response that is immutable by design. So it added the ten new
targets beside the twelve already there, and a twelve-parcel operation became a twenty-two-parcel
one that had never happened. On the persistent environment, two of the added assignments had by then
been visited and answered.

The tempting repair — delete the extras — is wrong twice over. It cannot work: eight of the ten are
deletable in a purely technical sense and two are not, so deleting the deletable ones would leave
fourteen assignments and six responses, which is no fixture's baseline either. And it is the wrong
shape: it rewrites the record of an operation that ran so that a newer plan appears to have been the
plan all along.

Underneath that sits a modelling question the product had not answered. **What is a campaign?** If
it is a *plan*, editing its target set is natural and the drift is a bug in how the edit was applied.
If it is an *operation*, its target set is a fact about something that happened, and editing it is a
falsification.

## Decision

### 1. A campaign is an operational snapshot, and it is never rewritten

A `SurveyCampaign` records an operation: these parcels, this questionnaire version, this period,
these technicians, this work. Once field activity exists under it, **its target universe is
history**. A revision that changes what should be covered does not edit it. It:

1. **closes** the campaign that ran — `CLOSED`, dated, keeping every assignment, visit, response
   and answer it ever had; and
2. **opens a new campaign** for the new intended universe.

Nothing is deleted, nothing is cancelled, no response is touched. `assertCampaignClosable` (domain)
and `closeCampaign` (application, `field.campaigns.manage`, audited) are the transition; a `DRAFT`
cannot be closed, because nothing happened under it.

### 2. Identity is a declared key, not the display name

The demo seeder identified its campaign by **name**, which is Spanish, user-facing and free to
change for reasons that have nothing to do with scope. The fixture now declares a `key`
(`zamora-field-operations-v2`), the campaign id is derived from it deterministically — the same
technique the provenance records use — and a **changed key is a different campaign**. The seeder
closes whatever else is open, names it with the fixture's `supersededName`, and creates the new one.

This is deliberately not a versioning framework. There is one rule: *changed campaign semantics ⇒ a
new key*. A wording change is not a new key; a changed target universe is.

### 3. Exactly one campaign is the current operation, and one function decides which

`resolveCurrentCampaign` — the active campaign; the most recently activated if there are several;
otherwise the most recently created. Optionally narrowed to one survey version, which is what a
tabulation needs: two campaigns on two different versions are already two universes, distinguished
by the version (TD-039), and the drift this rule exists for is two campaigns on the **same** version.

Every surface that means *now* consults it:

| Surface | Scope |
|---|---|
| Command Center field panel | the current campaign |
| FieldFlow overview | every campaign, the current one first and labelled *Operativo actual*; the rest *Operativo anterior* with a line saying they are kept whole and excluded from today's figures |
| Technician's own work | the active campaign (already true before this decision) |
| Social Intelligence: versions, tabulation, coding queue, workflow metrics, distributions | the current campaign **of that version** |
| Report snapshot | the current campaign of the version being reported, named in the universe section's own words |

History is not hidden: a closed campaign keeps its panel, its counts and its provenance, and every
row of it stays queryable.

### 4. What this does not touch

The **119 socioeconomic surveys** of the concluded study are a `HISTORICAL_OBSERVED` metric, not
rows in these tables. No campaign scope reaches them, and nothing here changes what they mean.

## Consequences

- A project legitimately accumulates campaigns, so **the project's total assignment count is no
  longer a fixture number**. The staging contract asserts the *current* operation exactly — its
  campaign, its parcels, its submitted responses — and asserts of history only that it is closed,
  dated and intact. It never relaxes an exact count to `>=`: that would let the next drift pass
  unnoticed, which is how this one did.
- The pilot's persistent environment keeps the twenty-two-assignment campaign as
  *Operativo de campo anterior*, closed, with its six submitted responses. It is the record of what
  the demonstration environment actually did.
- `supersedeOtherCampaigns` is application code with its own integration suite, rather than a step
  inside a seeder script, because "what happens to yesterday's operation" is a rule and not a
  detail of one fixture.

## Alternatives rejected

**Delete the drifted assignments.** Impossible without deleting submitted responses, and wrong even
where possible: it rewrites what happened so a newer plan matches.

**Accept 22/6 as the new baseline.** The number came from an accident, not from a decision, and
adopting it would teach the fixture to follow the environment instead of the other way round.

**Let a campaign's target set be edited, and version the edits.** That models a campaign as a plan
with a history of revisions. It is a real design — and it is a much larger one, needing an edit
history, a rule about assignments that no longer belong, and an answer for responses captured under
a superseded target set. A campaign as a snapshot needs none of that.

**Scope Social Intelligence by survey version alone.** It already was, and that is exactly how two
campaigns on one published version came to share a denominator.
