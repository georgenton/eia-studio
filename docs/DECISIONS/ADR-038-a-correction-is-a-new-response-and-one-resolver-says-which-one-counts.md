# ADR-038 — A correction is a new response, and one resolver says which one counts

- Status: Accepted
- Date: 18 September 2026
- Related: ADR-006 (a published questionnaire is immutable), ADR-022 (a report version is a frozen
  snapshot), ADR-026 (the current campaign), ADR-027 (a publication is not a mirror), ADR-028 (the
  offline device), ADR-030 (`PROJECT_DATA_MANAGER`), ADR-037 (writing the questionnaire),
  CLAUDE.md rule 9 (answers are immutable; corrections are new visits/instances).
- Amends `docs/TENANCY.md` §3.1 (one new project permission) and
  `docs/OFFLINE_SYNC_PROTOCOL.md` (protocol version 3). Closes TD-036, TD-084 and TD-114.

## Context

A submitted `SurveyInstance` and its answers refuse every write — by grant and by trigger since
Slice 3. That invariant is correct and this ADR does not touch it. What was missing is the other
half, which migration 0014 already named in the comment beside the trigger:

> *Correction, when it exists, will be a reviewed workflow that records who changed what — not an
> UPDATE that leaves no trace.*

Eight studies will produce corrections: a technician mistypes a figure, an informant asks for a
change, a coordinator spots an error, a revisit turns up better information. Until now the honest
answer was that the product could not represent any of them.

### What the audit found, and what it ruled out

Three existing constraints decided the shape before any schema was written.

1. **`survey_instance` is unique on `(tenant, assignment, version)`.** It is what makes a retried
   offline submit find the row it already wrote rather than create a second household. A correction
   captured against the *same* assignment would have to relax it.
2. **Tabulation is scoped by campaign** (`instanceInCampaign` joins through
   `field_assignment.campaign_id`). A correction captured in a different campaign would fall out of
   the very count it exists to fix.
3. **`field_assignment` was unique on `(tenant, campaign, parcel)`** — written when a second
   assignment for one parcel could only be a mistake.

## Decision

### 1. A correction is a new response on a new assignment, in the same campaign

`requestSurveyCorrection` creates two rows: a `field_assignment` carrying
`corrects_assignment_id`, in the **same campaign** and on the **same parcel**, and a
`survey_correction` naming what is being replaced and why.

Three things follow, and each was a requirement rather than a convenience:

- **the offline path needs no new command.** A correction assignment *is* an assignment, so
  `visit.start` → `survey.upsert_draft` → `survey.submit` → `visit.finish` work unchanged, with the
  same idempotency and the same conflict handling;
- **historical attribution is not mutated.** Who was originally assigned and who performed the
  correction are two rows with two `assignee_user_id`s and two visits, rather than one overwritten
  column;
- **`survey_instance`'s uniqueness is untouched**, so a retried submit is still a no-op.

Constraint 3 is restated rather than dropped: migration 0051 replaces it with a **partial unique
index** over assignments where `corrects_assignment_id is null`. One live *ordinary* assignment per
parcel per campaign — exactly the rule it was written about — and a correction sits beside the work
it corrects.

### 2. The questionnaire does not move

A correcting response answers the **same `SurveyVersion`** the original answered, enforced by
trigger at the moment the correction is applied. *What did we ask?* and *what is the effective
answer?* are different questions (ADR-037). Publishing a new version because one household's answer
was wrong would reinterpret every other response in the campaign.

### 3. Three states, and the two that are deliberately absent

`REQUESTED` → `APPLIED`, or `REQUESTED` → `CANCELLED`.

There is no `IN_PROGRESS`: whether a technician has started is already on the correction's own
assignment and its visit, and a second copy of that fact is a second thing to keep in step. There
is no `SUBMITTED` beside `APPLIED` either — that pair would imply an approval step between
capturing a correction and it taking effect, and there is none. **Submitting is applying**, in the
same transaction as the submit, because a separate call would open a window in which a response is
submitted and not yet effective, and that window is where two screens disagree.

**A correction that is requested and not captured changes nothing.** The original stays effective,
every count stays what it was, and the surface says so — because the obvious wrong assumption is
that asking has already removed the figure from the analysis.

### 4. One resolver, and it is a database view

This is the part the gate is about.

`app.effective_survey_instance` is a recursive view: start at every submitted response that is
nobody's correction, follow **applied** corrections, and return the last one reached. Social
tabulation, the numeric summary, validated theme distribution, field progress and the report
snapshot all join it through two exported helpers, and nothing writes its own predicate.

It is a view rather than a shared SQL string because `where superseded = false` written in six
modules is six chances to disagree — and the disagreement would be silent: two screens showing
different counts of the same households. An integration test walks
`packages/application/src` and fails if a seventh place names the view directly or invents its own
`superseded` predicate.

`security_invoker = true` is load-bearing and asserted: without it the view would run as its owner
and hand back rows the caller's policies refuse. A view is exactly the shape in which RLS is
accidentally bypassed, and the whole product reads this one.

**Wall-clock time decides nothing.** The chain is followed through an explicit relation, so two
corrections recorded in the same millisecond still have one order. `resolveEffectiveInstance` in
`@eia/domain` is the same rule in TypeScript, and a test asserts the two agree.

### 5. A lineage is a line, by constraint

| Guarantee | Mechanism |
|---|---|
| at most one live correction per response | partial unique index on `(tenant, original_instance)` where state ≠ CANCELLED |
| a response corrects at most one other | partial unique index on `(tenant, correcting_instance)` |
| no response supersedes itself | CHECK |
| no cycles | trigger walking the chain to the root, bounded at 64 generations |
| a state agrees with its evidence | CHECK: APPLIED has a correcting response and an `applied_at`; CANCELLED has neither |
| the correcting response is the one captured on this correction's own assignment, against the same version | trigger at apply time |
| a reason is words | CHECK `length(btrim(reason)) >= 12`, the bound `specialist_review` already uses |
| history is never deleted | `REVOKE DELETE` **and** a trigger |

A correction always applies to the response that is **currently effective**, refused in the domain
and again by the live-correction index. Correcting the original after correction 1 was applied
would leave two claimants to one household's answer and nothing able to choose between them.

### 6. Who may ask

One new permission, `field.corrections.request`, held by **COORDINATOR** and
**SOCIAL_SPECIALIST** — the two roles that read an individual response and are therefore the people
who notice it is wrong.

Not `field.capture`: somebody who could decide their own work was wrong and quietly replace it is
the failure invariant 9 exists to prevent. Not `field.validate` either — validating is accepting
what arrived; this is saying it must be captured again. A `FIELD_TECHNICIAN` holds neither the key
nor `field.responses.read`, and `PROJECT_DATA_MANAGER` gains nothing at all: a correction names a
household's response, and that role reads none.

### 7. What the device is told, and what it is not

The Field Pack's assignment gains a `correction` object: the assignment being corrected, the reason
a coordinator wrote, and when it was asked for. **No previous answer.** A device that would
otherwise never hold another visit's responses does not start holding them because a figure was
wrong (SECURITY.md §10e); knowing which question to re-ask is what the reason is for.

`FIELD_SYNC_PROTOCOL_VERSION` goes to **3**, because `packAssignmentSchema` is `.strict()` and a
new field breaks an older device's parse. That is the same rule that made ADR-037 bump to 2, and
the same reason `media.declare` needed no bump in Wave 2: a new command *type* changes no existing
meaning; a new *field* does.

### 8. Progress counts parcels, not captures

A correction assignment is **not** a parcel. Counting it in campaign progress would turn 141
parcels into 142 the moment somebody asked for one response to be captured again, and a coordinator
watching a percentage fall would have no way to see why. So the four assignment-state counts
exclude correction assignments, `submitted` counts effective responses, and open corrections are a
**fifth, separately named count** beside them.

### 9. The client portal is unaffected, and that is asserted rather than assumed

`portal.client_publication` is an immutable, allowlisted, composed snapshot (ADR-027). It reads no
survey response and therefore reads no correction. A publication made before a correction keeps
every word; a later one is composed from whatever is true when somebody publishes it. Nothing in
this change touches the portal, and nothing needed to.

### 10. Provenance on both

A correcting response gets its own `ProvenanceRecord`. It is **not** a modification of the original
— it is a new live observation made in order to supersede the previous one, and the method text
says exactly that. The original's record is untouched. The relation between them is the
`survey_correction` row, which is also where the reason lives.

### 11. Audit carries identifiers and nothing else

`field.survey.correction_requested`, `.correction_applied`, `.correction_cancelled`. Which response,
which correction, which assignment. **Never the reason** — a coordinator explaining an error
naturally quotes the answer that was wrong — and never the old or new value. What changed lives in
the two responses, each attributed and each permanent.

## Consequences

- One new table, one new column on `field_assignment`, one new enum, one view, one permission,
  three audit actions. Two migrations: 0050 additive, 0051 grants, RLS, constraints and the view.
- The unique constraint `field_assignment_campaign_parcel_key` becomes a partial unique index of
  the same name. Forward-only; no data is touched, because no correction assignment exists yet.
- `FIELD_SYNC_PROTOCOL_VERSION` 2 → 3. Devices must be rebuilt; none is distributed.
- Every analytic now joins one view. A new analytic that forgets to is caught by a test rather than
  by a coordinator noticing two screens disagree.

## What this does not do

- **It does not approve anything.** A correction takes effect when it is captured, by the person
  who captures it. There is no review step, and inventing a state for one would be the same fiction
  as a report status nobody sets (TD-060).
- **It does not correct a `HumanReview`.** TD-041 is the same gap one layer along and stays open:
  a coding of a superseded answer simply stops contributing, because the analytics read the
  effective response, and the coding itself is untouched.
- It does not let a technician initiate a correction, or edit one, from the device.
- It does not merge lineages, split them, or let a correction cross a campaign or a parcel.
