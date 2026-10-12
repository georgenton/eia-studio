---
"@eia/i18n": patch
"@eia/web": patch
---

A socialization's hour reads in the event's own time zone, and the invitation copy names the right
unit.

A convocation entered as 10:00 in `America/Guayaquil` is stored as `15:00Z` — correctly — and the
three socialization surfaces rendered that instant with the generic UTC formatter while printing
the event's zone beside it. The list, the detail and the **printable invitation handed to a
household** all said `15:00 · America/Guayaquil`: two different times on one line.

`formatDateTimeInZone` reads an instant in a named IANA zone, **including the calendar date**.
Fixing only the clock would have moved a 20:00 meeting in Guayaquil to the following morning on a
printed sheet, which is worse than the bug it replaced. An unusable zone falls back to the UTC
reading rather than throwing: a malformed row costs a reader the right hour, not the whole page.

The generic UTC formatter is untouched, and that is the point of adding one beside it rather than
changing it. Almost everything this product timestamps — a sync, a decision, an import — is an
instant whose only honest reading is the one the server recorded, and two readers in two places
should see the same string. A socialization is the exception: it is an appointment, and an
appointment is a wall clock in a place.

The same screen called repeated delivery visits *invitados* / *invitees*. The unit is **one
invitation with a history of attempts** (ADR-041), so the sentence meant to teach the model taught
its opposite. Both halves are corrected in both catalogues: *«Una invitación puede requerir varios
intentos de entrega: tres visitas al mismo predio siguen siendo una sola invitación.»*

No persistence, schema, permission or protocol change.
