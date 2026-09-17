---
"@eia/domain": minor
"@eia/application": minor
"@eia/contracts": minor
"@eia/db": minor
"@eia/i18n": minor
"@eia/testing": minor
"@eia/web": minor
---

Object storage, and a delivered file that becomes a document version (ADR-031).

`StoragePort` in the domain with an S3-compatible adapter and an in-memory one in the application
layer; nothing above the adapter knows a provider exists. A key is
`t/{tenantId}/p/{projectId}/{namespace}/{objectId}` — **no filename**, because a bucket listing is
the one place RLS does not reach and a delivered filename can name a person. This amends the layout
`docs/SECURITY.md` §7 and `docs/ARCHITECTURE.md` §5 stated.

The client never proposes a key. An upload is refused before a URL exists when extension, declared
type and ceiling disagree, and refused at finalize when the provider has no object, when it is empty
or over the ceiling, or when its first bytes are not the declared format's signature. The SHA-256 is
computed from the bytes read back; `ETag` is recorded as the provider's entity tag and never treated
as a content hash. `app.upload_intent` is consumable exactly once and `app.stored_object` is
immutable, both by trigger as well as by grant, both under FORCE RLS.

`resolveStorageAvailability` decides whether a file can be stored here at all, in the shape of
IG4-001: unset is unavailable, `memory` is refused outside `local` and `test`, and there is no
fallback. No process refuses to boot over it.

Uploading on the Documents surface writes a `DocumentVersion` in `UPLOADED` /
`PENDING_EXTRACTION` — uploaded is not processed, and both surfaces say so. The same bytes twice are
answered rather than duplicated; a corrected delivery is v2 and v1 is untouched; a code the project
already uses is refused with a sentence. The privacy classification defaults to *review required*.

New configuration: `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ENDPOINT`,
`STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` (all optional; `STORAGE_FORCE_PATH_STYLE`
removed — path style follows from having an endpoint). Readiness gains `project.storage` (advisory),
closing TD-089. `DOCUMENT_KIND_LABELS` and `TEXT_SOURCE_LABELS` leave `@eia/domain` for
`vocabulary.documentKind.*` and `vocabulary.textSource.*`, so the English UI stops showing Spanish
document kinds. Migrations 0037, 0038, 0039 — additive and forward only.
