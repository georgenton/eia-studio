# Field media

> Related: ADR-032 (this layer's decisions), ADR-031 (object storage), ADR-028 (EIA Field),
> `docs/OBJECT_STORAGE.md`, `docs/OFFLINE_SYNC_PROTOCOL.md`, `docs/SECURITY.md` §7, §10b, §10e.

## 1. What a photograph is here

Evidence of a **visit**: the parcel, what the works would affect, how the place is reached. It is
taken on a technician's phone, usually with no signal, and it belongs to the visit that produced it.

| | |
|---|---|
| The bytes | a `stored_object` under `t/{tenantId}/p/{projectId}/field-media/{objectId}` — no filename in the key (ADR-031 §1) |
| The statement | a `field_media` row: kind, capture time, note, the technician's own position, the visit |
| Who may see it | the technician who took it, or someone holding `field.responses.read` |
| Who may file one | the technician who uploaded the bytes, in their own name, and nobody else |

## 2. The four kinds, and the two that do not exist

`parcel` · `affectation` · `access` · `other`.

There is no `document` kind and no `signature` kind. Photographing an identity card, a deed or a
signed attendance sheet produces identified personal data, and the compliance gate of SECURITY.md
§10a has not authorised collecting any. The application asks the **camera** and never the photo
library, for the same reason: a picker over the whole device is a picker over everything else on it.

A photograph of a parcel can still hold a person, a house number or a number plate. That is why the
row-level policy is `survey_instance`'s rather than ordinary project access.

## 3. Where field media never goes automatically

| Where | What prevents it |
|---|---|
| **Client portal** | the publication payload is composed from a closed vocabulary (ADR-027); there is nowhere in it for a file, a key or a URL |
| **AI provider** | the classifier's input carries text and a taxonomy; the assistant reads `document_chunk`. Neither type can hold an image |
| **Document corpus** | `uploadDocumentVersion` refuses a `field-media` object; `declareFieldMedia` refuses a `documents` one. A namespace is what a file *is* |
| **Public maps** | a layer comes from a `SpatialDatasetVersion`. Media is not a layer, and its only point is the technician's position |

Each is asserted by a test, not by this table. What a person may do **deliberately** is a different
question and today the answer is *nothing*: there is no export, no attach-to-report and no publish.

## 4. The device, in order

```
shutter → copy file into the app's own directory → write local_media row     (offline, always)
        → intent → PUT → finalize                                            (when there is signal)
        → queue media.declare through the ordinary outbox
        → server acknowledges → sweep deletes the local file
```

**The local file is the last thing to go, and only the server's acknowledgement releases it.** Not
the PUT returning 200: bytes in a bucket are not a `field_media` row, and a finalize that never ran
leaves an object nothing points at. One predicate — `mayDeleteLocalFile` in `@eia/domain` — decides,
and `apps/field/test/media-upload.test.ts` is where it is proved.

Consequences worth stating:

- **A photograph taken before `visit.start` was acknowledged waits**, with its file, exactly as a
  draft survey does. When the visit id arrives it reaches the waiting rows in the same step that
  patches the queued commands.
- **Every failure in the sequence is the same answer**: keep the file, keep the row, try later.
  There is no branch that deletes anything.
- **Nothing is re-encoded, resized or stripped.** A photograph is evidence; a device that silently
  altered it would be producing something the technician did not take. EXIF handling belongs where
  a file is exported, which is a surface this product does not have (SECURITY.md §7).
- **A retry cannot duplicate.** `localId` is minted at the shutter and never regenerated;
  `commandId` identifies the attempt, `localId` identifies the photograph.
- A retried *upload* may mint a fresh intent and therefore a fresh object. That costs an orphan in
  the bucket, and the alternative costs a photograph.

## 5. The two routes

| Route | Does | Idempotent |
|---|---|---|
| `POST /api/field/media/intent` | mints the key, signs a PUT URL, records an `upload_intent` | no — each call is a new authorisation |
| `POST /api/field/media/finalize` | verifies against the provider, writes the `stored_object` | **yes** — a second call asks what the first one wrote |
| `POST /api/field/sync` (`media.declare`) | writes the `field_media` row | yes, twice over: the receipt and `localId` |

`finalizeUpload` itself is *not* idempotent and must not be: consuming an authorisation twice is
what the intent's state machine prevents. The route is idempotent because it asks a different
question when the first one is already answered. Idempotency belongs in the caller's protocol.

`media.declare` did **not** bump `FIELD_SYNC_PROTOCOL_VERSION`. A new command type changes no
existing meaning; an old device never sends it, and an old server rejects it as an unknown
discriminant. Nothing was added to `commandResultSchema`, which is `.strict()` and would have
broken an older device's parse.

## 6. What a person sees

| Surface | Shows |
|---|---|
| EIA Field, assignment screen | three capture buttons, and each photograph's local state — *pendiente de subida* / *subiendo* / *subida* |
| Parcel Workspace › *Fotografías* | kind, capture time, the technician's note, size, and **whether** there is a position — never the position |
| Parcel Workspace, without `field.responses.read` | a `permission denied` state saying why a photograph sits behind that grant |

A coordinate on a list is a coordinate in a screenshot, and this one is a person's position at a
moment; the read models return `hasLocation`, a boolean.

## 7. Audit

`field.media.declared` records the visit and the kind. Never the note — free text a technician
wrote — and never the coordinates: an audit line is read by more people than the row is.

## 8. What is not built

- **Downloading a photograph from the workspace.** `presignStoredObjectDownload` exists and is
  permission-checked; no button calls it yet (TD-093), and the audit line an issued link should
  write does not exist either.
- **A retention rule on the server.** The device deletes its copy; the object and the row are kept
  for the life of the project, under the tenant's ordinary retention policy (SECURITY.md §10).
- **Capture on a real handset.** There is still no native build artefact (TD-082). The camera path
  is proved by unit tests over an injected transport, by an integration suite against real MinIO
  and Postgres, and by a bundle that exports for both platforms — and not by a phone (TD-096).
