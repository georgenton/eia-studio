---
"@eia/domain": minor
"@eia/i18n": minor
"@eia/db": minor
"@eia/field-sync-contract": minor
"@eia/application": minor
"@eia/web": minor
"@eia/field": minor
---

Socializations: an invitation is the unit, an attempt is the history of trying, and protocol v4 carries both.

A consulting firm can now convene the people a road runs past. Three tables under FieldFlow — an
event, an invitation per parcel, and the attempts at delivering it — behind one new project
permission, `field.socializations.manage` (COORDINATOR and SOCIAL_SPECIALIST), with no new
capability: a socialization is field work, and the catalogue still holds 14 keys.

Every count is over **invitations**. Three visits to one gate are one invitee, so `ABSENT` and
`OTHER` leave the invitation open and attempts are shown apart and labelled. An invitation names a
parcel, never a person. An event's time, place and title **freeze** once somebody has been told
them, because there is no way to un-tell a date; a different convocation is another event.

`field.assignments.manage` finally grants something: a board of parcels and their technicians,
decided one at a time, with no automatic split — and refused outright once a visit, a response or
a photograph exists, naming the revisit that does exist instead.

**Protocol v4** lives beside v3 at `/api/field/v4/*`, which is untouched. `surveyWork` is nullable,
so a project whose campaign closed with invitations still to deliver produces a valid pack where v3
produced an empty day; discovery returns the projects rather than a terminal "several"; and one new
command, `socialization.delivery.record`, runs on v3's own engine. A delivery captured offline
against an invitation that has since changed hands comes back as a **conflict** with the attempt
and its photograph kept — never a silent re-attribution of one person's walk to another.

Delivery evidence has its own private namespace and is never re-encoded, never stripped of EXIF
and never reachable publicly.

**EIA Field cannot yet deliver an invitation.** The local schema, the device's rules, the
repository, the API client and the evidence sync module are built and unit-tested; the sync engine
is not rewired to v4 and the three screens are not written (TD-126).
