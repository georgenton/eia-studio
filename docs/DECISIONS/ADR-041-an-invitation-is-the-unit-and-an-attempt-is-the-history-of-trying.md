# ADR-041 — An invitation is the unit, and an attempt is the history of trying

- Status: Accepted
- Date: 19 September 2026
- Related: ADR-018 (offline capture is configuration), ADR-026 (the current campaign), ADR-028
  (the offline device), ADR-031 (object storage), ADR-032 (a photograph is evidence of a visit),
  ADR-037 (writing the questionnaire), ADR-038 (a correction is a new response),
  `docs/SECURITY.md` §10b and §10e, CLAUDE.md rules 4, 5 and 7.
- Amends `docs/TENANCY.md` §3.1 (one new project permission) and
  `docs/OFFLINE_SYNC_PROTOCOL.md` (protocol version 4 beside version 3).

## Context

A consulting firm holds *socializaciones*: meetings at which a study is presented to the people a
road runs past. Before each one, somebody must be invited — in practice a technician walks the
corridor with a stack of printed invitations and hands one over at each gate.

Until this block the product could represent none of it. Three things were missing and one was
wrong.

**`field.assignments.manage` granted nothing.** The permission has existed since Slice 3. A
campaign's assignments arrived from a seeder, and the only way a parcel changed hands was a
correction revisit (ADR-038). Eight production studies cannot each be a developer task.

**There was no model of a convocation**, so there was nowhere to record that a household had been
told, and no way to show a consultancy what proportion of the corridor it had reached.

**The mobile protocol could not express work that is not a survey.** `FieldPack` requires a
campaign. A project whose survey campaign closed last month, with five invitations still to
deliver, produced `no_active_campaign` and an empty day — in a project where the technician had
plenty to do. `/api/field/scope` had the same shape of problem one level up: work in more than one
road was a terminal state, because the application held one pack by database constraint.

### What was ruled out before anything was written

- **Attendance.** Who turned up is a different fact, collected at the meeting by a different act.
  A product that inferred it from a delivered invitation would be asserting that somebody was
  present because a piece of paper reached their gate.
- **A model of people.** This product holds no record of anybody who is not one of its users.
- **A fifteenth capability.** A socialization is field work; splitting *does this project do field
  work?* across two switches is the mistake ADR-035 §8 avoided for `quality.rag_assistant`.
- **A workflow engine**, messaging, route optimisation, QR codes and registration. Each is a
  product of its own and none was asked for.

## Decision

### 1. The invitation is the unit of count; the attempt is the history of trying

Three tables under FieldFlow: `socialization_event` → `socialization_invitation` →
`socialization_delivery_attempt`.

Three visits to one gate are **one invitee**. Every figure the product shows about a convocation
is over invitations — delivered, pending, refused, cancelled — and `attempts` sits beside them,
labelled, with the distinction written on the screen. A single figure mixing the two answers
neither *how many households were convened?* nor *how much walking was done?*

It follows that `ABSENT` and `OTHER` leave the invitation `PENDING`: nobody was told anything, and
an invitation closed because one visit found nobody home would record a convocation that did not
happen. `DELIVERED` and `REFUSED` settle it.

### 2. An invitation names a parcel, never a person

A parcel is the territorial unit the cartography gives, the one every other surface works in, and
the one a technician can find. `recipient_label` is an optional string somebody wrote on a list by
hand: never derived from a survey answer, never required, and absent from every audit line.

### 3. An event's logistics freeze once somebody has been told them

The moment the first invitation exists, the event's time, place and title are what somebody was
told — on paper, at a gate. There is no mechanism in this product, or in the world, to un-tell a
date. So they freeze, in the domain and again in a database trigger, and a genuinely different
convocation is **another event**. Events are small and a project has many.

This is deliberately not a versioning scheme. A general "version anything editable" mechanism is a
large thing to build for one table whose honest answer is *make a new one*.

### 4. One permission for the convocation, and the existing one for who goes

`field.socializations.manage` (COORDINATOR, SOCIAL_SPECIALIST) covers the whole surface: creating
an event, generating invitations, cancelling, reading the attempts and their evidence. Consultation
is what a social specialist does, and needing a coordinator to press every button would make the
coordinator a bottleneck in somebody else's work.

Choosing **who delivers** is `field.assignments.manage` — the same key that decides who surveys a
parcel, because it is the same decision about the same people's days. A specialist holds both by
role; the two keys say it is two acts.

No role was elevated and no role was created for a person.

### 5. A delivered invitation needs a photograph, in its own namespace

`socialization-evidence`, and the two namespaces it is not are the point: not `field-media`, which
is evidence of a *visit* and is read by the surfaces that read a visit; and emphatically not
`portal-editorial`, which is the one namespace whose objects a visitor can be served.

Nothing re-encodes it and nothing strips its EXIF. This is evidence, and the rule for evidence is
ADR-032's: the file is what the camera wrote. No public route resolves the prefix.

The other three outcomes record that nothing was delivered, so there is nothing to evidence —
demanding a photograph of an empty gate teaches people to photograph empty gates.

### 6. A delivery captured offline is attributed to whoever made it, or to nobody

Between a capture in a valley and a sync hours later, an invitation may have been reassigned, the
event cancelled, or somebody else may have delivered it. None of those is the technician's mistake
and none of them may cost them their work.

So the device sends the `invitationRevision` it read, the server compares it, and the answer is
**conflict**: the attempt and its photograph are kept and marked *requires review*. It is never a
silent re-attribution of one person's walk to another, and never "not found" — which a device
cannot tell from a malformed command, and would respond to by discarding a photograph of a real
delivery.

The row-level policy correctly hides a reassigned invitation from the technician who held it, so
`app.socialization_delivery_conflict` answers that one question from outside RLS and returns a
**six-label enum** and nothing else. It is a third class of privileged helper beside the boolean
membership predicates and the job claimers, with its own rule: a closed vocabulary, because `text`
would be a place where a row's own words could one day be put.

### 7. Protocol v4 lives beside v3, at its own paths

Every v3 object is `.strict()`, so a field added to one is a parse error on a device built against
v3 — which is the point of `.strict()` and the reason the version number exists. v3 is untouched,
byte for byte, at `/api/field/*`. v4 is at `/api/field/v4/*`. There is no negotiation and no body
that means two things.

Three changes, each of which needed the version:

- **`surveyWork` is nullable.** §Context's third problem, solved.
- **Discovery returns a list.** The technician chooses which road their morning belongs to; a
  device that picked the first of several would be making that choice for them.
- **One new command**, `socialization.delivery.record`, with its own payload and conflict
  vocabulary.

The other five commands mean exactly what they meant, so the v4 route rewrites their envelope and
runs them through v3's own engine. A second sync engine is the thing this block was told not to
build: two engines would eventually disagree about what a retry means.

### 8. The local database upgrades forward, and never clears a handset

A device in the field is holding drafts, an outbox and photographs when the application updates.
Local migration 4 adds three tables and drops nothing. A v3 pack it is holding is **converted** to
a v4 one — the same project, the same campaign, the same assignments, no invitations, the server's
own validity window — so the technician keeps working with what they have instead of being told to
find a signal. The conversion is marked, and the next download replaces it.

### 9. One project offline at a time, and the switch happens online

A second downloaded pack is a second answer to *which study am I in?*, and holding one is what
makes "you have unsynced work" a sentence the application can say truthfully.

So the switch is refused while anything is unsynced — naming what, by kind — and the new pack is
downloaded and **validated in full before the old one is touched**. A failed download leaves the
device exactly as it was. The ordering is written down as a value rather than left implicit in a
function body, because the ordering *is* the safety property.

The alternative — syncing the pending work automatically on the technician's behalf — is a sync a
person did not ask for, at a moment they are thinking about something else, and if it conflicts
they are reading about yesterday's road while standing on today's.

### 10. The local photograph is released by the acknowledgement, not by the upload

Intent → PUT → finalize → store the id → queue the command → push → **acknowledge** → delete the
file. `mayDeleteEvidenceFile` names only `SYNCED` with a server attempt id. Bytes being in a
bucket is not the same fact as the row existing, and the gap between them is exactly where
somebody's evidence would go. A conflict never releases the file either.

## Consequences

### What this buys

A consultancy can convene a corridor from the desk, see what proportion of it has been reached,
and hand a technician a printed invitation per parcel. The counts are honest about what they
count. A technician's walk is attributed to them or to nobody.

And `field.assignments.manage` finally grants something: who surveys each parcel is decided in the
product, by a person, one parcel at a time.

### What it costs, and what is not built

- **No attendance, no registration, no messaging, no routing, no QR.** §Context.
- **One invitation belongs to one parcel and one event.** A household that should receive two
  invitations to one event cannot be represented; nobody has described that case.
- **The mobile application is not finished.** The local schema, the device's own rules, the
  repository, the API client and the delivery/evidence sync module are built and unit-tested; the
  sync engine is **not** rewired to v4 and the three screens — project selector, invitation list,
  delivery capture — are not written. A device therefore cannot yet deliver an invitation. This is
  stated here rather than implied by an absent file, and `docs/TECH_DEBT.md` carries it.
- **No emulator ran.** The mobile reasoning is verified by unit tests over pure functions; the
  handset journey remains the gate it was.

### The one thing to watch

`field.responses.read` is the door an invitation takes, and an invitation is not a response. It was
reused rather than duplicated for the reason TENANCY.md §3.2 gives about Social — a second
transaction-local setting for "may see other people's field rows" is a second thing that can drift
— but it is a reuse, and if the two ever need to differ this is the place that will have to split.
