# ADR-031 — A storage key is not a filename, and an uploaded file is not yet a document

- Status: Accepted
- Date: 17 September 2026
- Related: ADR-012 (hosting and portability), ADR-013 (Drizzle + reviewed SQL), ADR-015 (domain
  purity), ADR-020 (no citation nobody can check), ADR-021 (retrieval is full-text), ADR-029 (the
  product is bilingual), ADR-030 (project intake), IG4-001 (an unset provider is not a fake one),
  `docs/OBJECT_STORAGE.md`, `docs/DOCUMENT_UPLOAD_AND_VERSIONING.md`, `docs/SECURITY.md` §7.
- Amends: `docs/SECURITY.md` §7 (object key layout), `docs/ARCHITECTURE.md` §5 (the same line).

## Context

Every document in the product today was put there by a seeder. `SourceDocument` →
`DocumentVersion` → `DocumentChunk` exists and works, but nothing in it has ever met a file: the
pilot's corpus is excerpts transcribed by hand, `TEXT_SOURCES` says so, and there is no object
store, no upload path and no `StoragePort` implementation. Eight rural-road studies go live on
15 October 2026, each arriving as a folder of PDFs and DOCX files somebody has to load.

Three questions had to be settled before any byte moved.

**What may a key contain?** `docs/SECURITY.md` §7 has said since Gate 1 that keys look like
`t/{tenant}/p/{project}/{module}/{object_id}/{filename}`. A bucket listing is a flat text file that
operators, backups, provider consoles and support tickets all see. A parcel owner's surname in a
delivered filename would be in every one of them, outside the `pii` schema and outside RLS.

**Who chooses the key?** If a client may name the object it uploads, it may name a key under
another tenant's prefix. No amount of checking afterwards recovers from having asked the question.

**When is an upload true?** A browser saying "done" is a claim. The provider's `ETag` is not a
content hash — for a multipart upload it is a digest of digests — so treating it as SHA-256 would
put a value in a column named `sha256` that is not one.

And one that decides how the rest reads: **is a stored file a document?** No. Extraction has not
been written (it is the next PR). A version whose text nobody has read has no passages, and a
surface that showed it as an ordinary document with zero passages would be saying *this document
contains nothing*.

## Decision

### 1. A key is tenant, project, namespace and an id this product minted

```
t/{tenantId}/p/{projectId}/{namespace}/{objectId}
```

Six segments, four of them UUIDs, `namespace` ∈ {`documents`, `field-media`}. **No filename, no
extension, no code, no date.** `buildObjectKey` is the only way to make one and it takes no string
a person typed; `parseObjectKey` is strict and `assertObjectKeyBelongsTo` re-checks a stored key
against the caller's own tenant and project before it is used.

The delivered filename is kept — on the row, under RLS, where reading it is an authorized act —
and the download link carries it as a `Content-Disposition` name. What changes is that it is no
longer part of the object's address.

This **amends `docs/SECURITY.md` §7 and `docs/ARCHITECTURE.md` §5**, which named a filename segment.
The rest of both sections stands: tenant/project prefixes, private buckets, presigned URLs only,
short TTLs.

### 2. The server generates the key; the client never proposes one

`createUploadIntent` takes a namespace, a filename, a declared type and a size. It returns a URL.
It never takes a key. The permission it requires is the namespace's — `documents.write` for a
document, `media.upload` for a field photograph — so a technician cannot file a report and a
coordinator cannot upload a photograph in a technician's name.

### 3. Three formats of checking, none of which is the client's word

An upload is refused **before a URL exists** when the extension, the declared MIME type and the
format's ceiling do not agree (`assertDeclaredUploadAllowed`). It is refused **at finalize** when
the provider has no object under that key, when the stored object is empty or larger than the
ceiling the intent signed for, or when the file's first bytes are not the declared format's
signature (`assertBytesMatchFormat`). The renamed `.exe` fails there: everything the browser did
succeeded, and no version exists.

The allowlist is two formats for documents (`.pdf`, `.docx`) and two for field media (`.jpeg`,
`.png`). This is a gate, not antivirus, and does not pretend otherwise: a denylist would have to
enumerate what is dangerous, which is the set nobody can finish.

A `.docx` is a ZIP, so `ARCHIVE_LIMITS` bounds entry count, per-entry size, total uncompressed size
and compression ratio. Nothing executes any part of it — extraction reads entries, never runs them.

### 4. The hash is computed from the bytes, and `ETag` is never it

`finalizeUpload` reads the object back from the provider and computes SHA-256 itself. `StoredObject`
carries `etag` as the provider's own entity tag, documented as *not* a checksum, and no code path
compares it to a hash. Where provider semantics differ, the answer is to record what the provider
said and compute what we need — not to relabel one as the other.

### 5. Storage availability is resolved, never defaulted, and never falls back

`resolveStorageAvailability` mirrors `resolveClassifierAvailability` (IG4-001):

| `APP_ENV` | unset | `memory` | `s3`, incomplete | `s3`, complete |
|---|---|---|---|---|
| `local`, `test` | unavailable | **available** | `BLOCKED_EXTERNAL_CONFIG` | available |
| anything else | unavailable | **refused** | `BLOCKED_EXTERNAL_CONFIG` | available |

An unset provider does **not** become the in-memory store. A `DocumentVersion` whose bytes lived in
a process that has since exited is a citation nobody can resolve, and it looks exactly like one that
can — the same artefact IG4-001 exists to prevent, one layer down. An unrecognised provider name is
reported as itself rather than read as "unset", because being told `s3x` is not a provider is a
fixable message and being told the variable is unset when it plainly is set is not.

No process refuses to boot over it. Storage unavailable removes the upload panel and says why; every
surface that does not store a file is untouched.

### 6. A document is a name; a version is a file; the same file twice is answered

Uploading to an existing document makes **v2**, and v1's object, hash and row are untouched —
because a finding raised in March cited words, and moving them would move what it said. Uploading
byte-identical content to the same document is answered (`outcome: "same_content"`, naming the
version that already holds it) rather than creating a version that differs only in number.

Deduplication is scoped to the project and namespace, never across tenants: whether another firm
holds the same file is not a fact this product may reveal.

A code the project already uses is refused with a sentence — *this project already has a document
DOC-014; add a version to it instead* — rather than a unique-constraint violation, because two
documents with one code make every citation naming it ambiguous.

### 7. Uploaded is not processed, and the surface says which

A new version lands as `processingState = UPLOADED`, `textSource = PENDING_EXTRACTION`,
`pageCount = 0`, `chunkCount = 0`, `chunkingStrategy = "pending"`. The list column and the version
page both name the state, and the version page explains it. `REQUIRES_OCR` and `FAILED` are in the
enum now and produced by the extraction worker in the next PR.

`content_hash` — the *text* hash — holds the file hash until extraction writes a real one, because
the empty string's digest is a value every unprocessed version would share; `file_sha256` beside it
says which is which.

### 8. Privacy classification is a claim somebody made

`privacy_classification` defaults to `REVIEW_REQUIRED`, never to "none known". The product has read
nothing at upload time, and a green state nobody checked is the one that would later be quoted. Only
`NO_PERSONAL_DATA_KNOWN` is eligible to leave for a model provider, which is the existing
`contains_pii` refusal (ADR-021 §4) expressed on the new column.

### 9. Two tables, both under FORCE RLS, both write-once where it matters

`app.upload_intent` (state `ISSUED → FINALIZED | ABANDONED`, consumable exactly once, enforced by a
trigger) and `app.stored_object` (immutable after insert, by `REVOKE UPDATE, DELETE` **and** a
trigger — migration 0002's permissive default privileges make the REVOKE load-bearing, as in
Slice 5). Both carry `tenant_id`, `project_id` and the composite FK.

## Consequences

- Two providers are configured the same way: MinIO in CI and locally, AWS/R2/anything S3-compatible
  in a deployment. `forcePathStyle` follows from having an endpoint, so there is no separate switch.
- **Normal CI does not require a cloud bucket.** The integration suite runs a MinIO container from
  MinIO's own registry (`quay.io/minio/minio`), and the e2e suite runs the in-memory store.
- There is no bucket in staging or production yet. That is an owner action — an account, a paid
  subscription and a credential — and this wave stops at naming it (`docs/OBJECT_STORAGE.md` §7).
- Nothing uploaded is citable until the extraction worker exists. Until then the Quality Gate and
  the assistant keep reading the transcribed corpus, unchanged.
- A field photograph can be uploaded through the same machinery, and deliberately is not yet: the
  `field-media` namespace, its permission and its formats are here, and the `Media` row, the mobile
  queue and the retention rules are the next PR.

## Alternatives considered

**Keep the filename in the key** (as `docs/SECURITY.md` §7 said). Rejected: it puts a name a
respondent or an owner may be in, in the one place RLS does not reach.

**Let the client presign its own key.** Rejected: a client that can name a key can name another
tenant's.

**Trust `ETag` as the content hash.** Rejected: it is not one, and a column named `sha256` holding
something else is worse than no column.

**Stream uploads through the application.** Rejected: a 90 MB study through a request, out again.
Presigned direct upload is why the provider is an S3-compatible one.

**Fall back to the in-memory store when nothing is configured.** Rejected for the reason in §5.

**Extract on upload, in the request.** Rejected: long work is always a job (ARCHITECTURE §9.1), and
an upload that could time out on a big PDF would lose the file as well as the extraction.
