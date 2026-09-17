---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/i18n": minor
"@eia/field-sync-contract": minor
"@eia/field": minor
"@eia/web": minor
---

Field media: a photograph is evidence of a visit, and the local file is the last thing to go
(ADR-032). Closes TD-037 and TD-080.

`field_media` under FORCE RLS with the row-ownership predicate of SECURITY.md §10b — *mine, or I
hold `field.responses.read`* — written once by `REVOKE UPDATE, DELETE` and a trigger, and with an
insert policy that has no escape: a caller may only declare photographs in their own name. The
bytes travel ADR-031's upload path and are verified before the row exists.

EIA Field captures with the camera (never the photo library), copies the file into its own
directory and writes the local row **before** anything is attempted, uploads when there is signal,
declares through the ordinary outbox, and deletes the local file only once the server acknowledges
the row. `localId` is minted at the shutter and never regenerated, so a retry is one photograph;
a unique index says the same thing again.

Four kinds — `parcel`, `affectation`, `access`, `other` — and deliberately no `document` and no
`signature`. Field media never automatically reaches the client portal, an AI provider, the document
corpus or a public map, and each is prevented by a type or a query rather than by a rule.

New: `media.declare` on the sync protocol (no version bump — a new type changes no existing
meaning), `POST /api/field/media/intent` and `POST /api/field/media/finalize` (the second
idempotent), `field.media.declared` in the audit vocabulary, `vocabulary.mediaKind.*`, and the
Parcel Workspace's *Fotografías* tab, which lists descriptions and never links. Migrations 0040 and
0041, additive and forward only. `expo-image-picker` and `expo-file-system` added to EIA Field.
