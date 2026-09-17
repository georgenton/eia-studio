# ADR-032 — A photograph is evidence of a visit, and the local file is the last thing to go

- Status: Accepted
- Date: 17 September 2026
- Related: ADR-028 (EIA Field), ADR-031 (object storage), ADR-027 (the portal is a publication),
  ADR-021 (retrieval is full-text), ADR-019 (rules calculate, AI proposes), D-020 / ADR-018
  (offline capture is configuration), `docs/FIELD_MEDIA.md`, `docs/SECURITY.md` §10b and §10e.
- Closes: TD-037, TD-080.

## Context

EIA Field ships capture without a camera. `docs/TECH_DEBT.md` has carried TD-037 since Slice 3 and
TD-080 since Wave 1, and the reason given each time was the same: there was no `Media` table, no
storage adapter and no bucket, and *a camera button that stores photographs the product cannot
upload is worse than no button, because a technician would believe the evidence was captured.*

ADR-031 removed the second and third of those. What is left is the first, plus the question that
makes field media different from a document upload: **the device has no connection.** A photograph
is taken in a valley, and everything else — the intent, the PUT, the finalize, the declaration —
happens somewhere else, possibly days later, possibly after the application has been force-quit
twice.

Two further questions had to be answered before any of it could be built.

**How sensitive is a photograph of a parcel?** At least as sensitive as a survey answer. It can
contain a person, a house number, a number plate, the inside of a home.

**Where must it never end up?** The wave brief names four places: the client portal, an AI provider,
the document corpus and a public map. A prohibition that lives in a document is a prohibition
somebody forgets.

## Decision

### 1. A photograph is a `field_media` row; the bytes are a `stored_object`

The upload path is ADR-031's, unchanged: `createUploadIntent` → PUT to the provider → `finalizeUpload`.
That is what checks the format, the ceiling and the magic bytes and computes the SHA-256. By the
time `declareFieldMedia` runs, the bytes are verified and the expensive half is done.

`field_media` says what those bytes *are*: this kind of photograph, taken at this moment, belonging
to this visit. Nothing in this module reads an image.

### 2. Four kinds, and the two that are missing

`parcel`, `affectation`, `access`, `other`. There is **no** `document` kind and **no** `signature`
kind, because photographing an identity card, a deed or a signed attendance sheet produces
identified personal data and the compliance gate of SECURITY.md §10a has not authorised collecting
any. The honest way not to collect something is to have nowhere to put it — the argument the
classifier's input type already makes about respondents.

The device asks the camera and never the photo library (`photosPermission: false`): a picker over
the whole device is a picker over everything else on it.

### 3. The four prohibitions, each prevented by structure

| Where | What prevents it | Asserted in |
|---|---|---|
| Client portal | the publication payload is *composed* from a closed vocabulary with nowhere to put a file, a key or a URL | `packages/domain/test/field-media.test.ts` |
| AI provider | the classifier takes text and a taxonomy; the assistant reads `document_chunk`. The declaration type holds identifiers and a bounded note — no bytes, no data URI, no key | same |
| Document corpus | `uploadDocumentVersion` refuses a `field-media` object and `declareFieldMedia` refuses a `documents` one. Both directions | `packages/application/test/field-media.integration.test.ts` |
| Public maps | a layer is a `SpatialDatasetVersion`; media is not a layer and its only point is the technician's own position | — (no code path exists) |

What a person may do **deliberately** is a separate question, and today the answer is *nothing*:
there is no export, no attach-to-report and no publish. When one is built it will be explicit,
audited and permission-guarded, which is the opposite of automatic.

### 4. Row ownership, not project access

`field_media`'s select policy is `survey_instance`'s: *this row is mine, or I hold
`field.responses.read`*. A GIS specialist may know a parcel was visited without seeing what was
photographed there (SECURITY.md §10b).

The **insert** policy is narrower still and has no `can_read_field_responses()` escape: a caller may
only declare photographs in their own name. Holding the permission to read what a household answered
is not the same as being able to file evidence as somebody else.

The row is written once — `REVOKE UPDATE, DELETE` **and** a trigger — because what a photograph is
of, and when it was taken, are statements a technician made at the shutter.

### 5. The local file is the last thing to go

**Never before the server has acknowledged the row.** Not after the PUT returns 200: bytes in a
bucket are not a `field_media` row, and a finalize that never ran leaves an object nothing points
at. One predicate in the domain, `mayDeleteLocalFile`, decides, and the device's retention sweep
asks it.

The order on the device is:

1. copy the file out of the picker's cache into the application's own directory, **then** write the
   local row — before anything is attempted, so a dying battery leaves a file and a row;
2. upload when there is signal; every failure in the sequence keeps both;
3. queue `media.declare` through the ordinary outbox, so it inherits the existing ordering, backoff
   and receipt replay;
4. sweep only files whose row came back settled.

Nothing is re-encoded, resized or stripped. A photograph is evidence, and a device that silently
altered it would be producing something the technician did not take. EXIF handling belongs where a
file is *exported*, which is a surface this product does not have (SECURITY.md §7).

### 6. `localId`, and why a retry cannot duplicate

Minted at the shutter, never regenerated. `commandId` identifies *this attempt to tell the server*;
`localId` identifies *the photograph*. A device that lost its outbox and re-formed the command mints
a new `commandId` and keeps the old `localId`, and the server still recognises one photograph.

It is enforced twice: the use-case looks it up and replays, and a unique index on
`(tenant_id, visit_id, local_id)` says the same thing. A second unique index on the stored object
closes the other door — the same bytes cannot arrive as a second row under a new `localId`.

A retried *upload* may mint a fresh intent, and therefore a fresh key and a fresh object. That is
deliberate: it costs an orphaned object, and the alternative — reusing an intent whose PUT may have
half-succeeded — costs a photograph. An object nobody points at is housekeeping; a lost photograph
is evidence that no longer exists.

### 7. Two routes, and the one that is idempotent

Bytes do not travel on the command channel, so the device calls `/api/field/media/intent` and
`/api/field/media/finalize` and then declares through `/api/field/sync` like everything else.

`finalizeUpload` refuses a second finalize, and must — consuming an authorisation twice is what the
intent's state machine prevents. The **route** is nonetheless idempotent, because a phone whose
response was lost in a valley cannot tell "already finalized" from "failed". It asks a *different
question* (`resolveFinalizedUpload`: what did the first call write?) rather than weakening the
first. Idempotency belongs in the caller's protocol, not in the rule.

### 8. `media.declare` does not bump the protocol version

`FIELD_SYNC_PROTOCOL_VERSION` stays 1. It exists so an old device cannot get a command's *meaning*
wrong; a new type changes no existing meaning, an old device never sends it, and an old server
rejects it as an unknown discriminant — the correct answer to a device newer than its server.

Nothing was added to `commandResultSchema`, deliberately: that object is `.strict()`, so a new field
there *would* break an older device's parse. `already_declared` is therefore reported as `applied`
on the wire, because from the device's side both answers mean the same thing — *the server has it,
you may release the file* — and a sixth outcome for a distinction the device cannot act on is
protocol nobody uses.

## Consequences

- TD-037 and TD-080 close. `field.surveys` gains no capability and no permission: `media.upload` has
  existed on `FIELD_TECHNICIAN` since Gate 1 and now has something to grant.
- The Parcel Workspace's *Fotografías* tab stops being an inert state and lists what was captured —
  descriptions, never links, because a link is a signature and forty of them rendered because
  somebody opened a tab would be forty grants nobody asked for.
- A project whose deployment has no bucket (TD-090) keeps working: the intent route answers 503 with
  a sentence, and the device keeps the photograph.
- **No photograph has been taken on real hardware.** There is still no native build artefact
  (TD-082), so the camera path is proved by unit tests over an injected transport, by an
  integration suite against real MinIO and Postgres, and by a bundle that exports for both
  platforms — and not by a handset. Recorded as TD-096 rather than implied.

## Alternatives considered

**Send the bytes through `/api/field/sync`.** Rejected: a 4 MB photograph base64-encoded inside a
command batch is three times its size through a request that also carries a day's captures.

**Delete the local file after a successful finalize.** Rejected — this is the decision the ADR is
named for. The finalize succeeding and the declaration failing is exactly the window a lost response
opens, and a file removed in it is gone.

**Strip EXIF on the device.** Rejected here and kept for export: altering evidence on capture means
the file in the study is not the file the camera produced, and SECURITY.md §7 already puts the
stripping where a file leaves.

**Put the photo library beside the camera.** Rejected: evidence of *this* visit is what the row
claims, and a library picker cannot make that claim true.

**A `document` or `signature` kind.** Rejected: see §2.
