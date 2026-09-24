# Object storage

> Related: ADR-031 (this layer's decisions), ADR-012 (hosting and portability), IG4-001 (an unset
> provider is not a fake one), `docs/SECURITY.md` §7 and §12, `docs/DOCUMENT_UPLOAD_AND_VERSIONING.md`.
> ADR-031 **amends** the key layout that `docs/SECURITY.md` §7 and `docs/ARCHITECTURE.md` §5 stated.

## 1. What this is

One port, `StoragePort` in `@eia/domain`, and two implementations in `@eia/application`: an
S3-compatible adapter and an in-memory one. Nothing above the adapter knows a provider exists —
`packages/domain` never imports the AWS SDK, which is the portability constraint of ARCHITECTURE
§9.1 rather than a style preference.

```
@eia/domain      StoragePort · buildObjectKey · assertDeclaredUploadAllowed · assertBytesMatchFormat
                 resolveStorageAvailability                     (pure; zod only)
@eia/application createS3Storage · createMemoryStorage          (the SDK lives here, and only here)
                 createUploadIntent · finalizeUpload · presignStoredObjectDownload
apps/web         getStorage()  →  StoragePort | null
```

## 2. The key

```
t/{tenantId}/p/{projectId}/{namespace}/{objectId}
```

Six segments; four are UUIDs; `namespace` is `documents` or `field-media`. **There is no filename
in a key, no extension, no document code and no date.**

A bucket listing is a flat text file that operators, backups, the provider's console and support
tickets all see, and it is the one place RLS does not reach. A delivered filename can be
*Levantamiento predio 41 — Sra. Rosa Chamba.pdf*. That name is kept on the row, where reading it is
an authorized act, and restored on the download link as a `Content-Disposition` name.

The client never proposes a key. `createUploadIntent` takes a namespace, a filename, a declared
type and a size, and returns a URL. A client able to name a key is a client able to name another
tenant's, and no check afterwards recovers from having asked.

## 3. Uploading, in three steps

| Step | Where | What it decides |
|---|---|---|
| 1. intent | `createUploadIntent` | May this caller upload this, here? The namespace's permission, the format allowlist, the size ceiling, the key, the signed URL, the `upload_intent` row |
| 2. transfer | the browser → the provider | nothing; it is a PUT to a URL the provider signed |
| 3. finalize | `finalizeUpload` | Did it actually happen? The intent is ours and unconsumed; the key is the one we issued; the provider has an object of an acceptable size; the bytes begin the way the declared format does; the SHA-256 we computed from the bytes we read |

The bytes never pass through the application. A 90 MB study streamed through a request only to be
streamed out again is the shape a presigned direct upload exists to avoid.

**The order of the checks at finalize is load-bearing**: each makes the next meaningful, and nothing
is written until all four pass. A refusal leaves the intent unconsumed, so nothing half-written is
left for somebody to find later, and a retry is a retry rather than a second document.

## 4. What is accepted, and what looking at the bytes is for

| Namespace | Formats | Ceiling | Permission |
|---|---|---|---|
| `documents` | `.pdf`, `.docx` | 120 MB, 60 MB | `documents.write` |
| `field-media` | `.jpeg`, `.png` | 25 MB each | `media.upload` |

Three claims must agree: the extension, the declared MIME type, and the **signature** at the head
of the stored file. A `.exe` renamed `.pdf` passes the first two and fails the third — at finalize,
after the bytes are already in the store, which is the only place the truth is available.

This is a gate and not antivirus. A denylist would have to enumerate what is dangerous, which is
the set nobody can finish.

A `.docx` is a ZIP. `ARCHIVE_LIMITS` bounds the entry count, per-entry size, total uncompressed
size and compression ratio, so a 40 KB file cannot ask the extraction worker for a gigabyte of
memory. Nothing executes any part of it.

## 5. The hash, and what `ETag` is not

`finalizeUpload` reads the object back and computes SHA-256 from the bytes. `StoredObject.etag`
carries the provider's own entity tag and is documented as **not a checksum**: for a multipart
upload it is a digest of digests, and providers differ. Nothing compares one to the other.

Deduplication is by that hash, **per project and namespace**. Never across tenants: whether another
firm holds the same file is not a fact this product may reveal.

## 6. Whether storage works here at all

`resolveStorageAvailability(appEnv, provider, bucket, region, endpoint, credentialsPresent)`:

| `APP_ENV` | unset | `memory` | `s3`, incomplete | `s3`, complete |
|---|---|---|---|---|
| `local`, `test` | `NOT_CONFIGURED` | **available** | `BLOCKED_EXTERNAL_CONFIG` | available |
| anything else | `NOT_CONFIGURED` | **`MEMORY_REFUSED_IN_PERSISTENT_ENVIRONMENT`** | `BLOCKED_EXTERNAL_CONFIG` | available |

- **There is no fallback.** An unset provider does not become the in-memory store. A
  `DocumentVersion` whose bytes lived in a process that has since exited is a citation nobody can
  resolve and looks exactly like one that can.
- **Unknown environments are persistent.** The predicate names `local` and `test`; everything else,
  including a misspelling, is persistent.
- **An unrecognised provider is named, not ignored.** `STORAGE_PROVIDER=s3x` reports `s3x`; telling
  an operator the variable is unset when it plainly is set sends them to the wrong place.
- **No process refuses to boot over it.** Unavailable removes the upload panel and states the
  reason; every surface that does not store a file is untouched.

### Variables

| Name | Required | Notes |
|---|---|---|
| `STORAGE_PROVIDER` | to have storage at all | `s3` or `memory`. No default (IG4-001's rule) |
| `STORAGE_BUCKET` | for `s3` | one bucket per environment |
| `STORAGE_REGION` | for `s3` | `auto` for R2 |
| `STORAGE_ENDPOINT` | for anything that is not AWS | http(s) only; path-style addressing follows from having one, so there is no separate switch |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | for `s3` | server-side only; the browser receives a signature, never a key |

## 7. Environments

| Environment | Store | Why |
|---|---|---|
| Unit tests | none | the domain's rules are pure and need no store |
| Integration (CI, local) | **MinIO in a Testcontainer**, an S3-compatible store pinned **by digest** (`chainguard/minio`). It was `quay.io/minio/minio` until 24 Sep 2026, when that image stopped being pullable anonymously — quay answers 401 and Docker Hub's `minio/minio` no longer resolves, so both CI jobs failed while cached laptops kept passing | real presigned URLs, real PUTs over the wire, real `HeadObject`. **Normal CI needs no cloud bucket and no credential** |
| e2e (CI, local) | `memory` | one server process; the bytes are the same bytes the use-cases verify |
| Local development | `memory`, or MinIO if a developer runs one | either is `local`, so either is allowed |
| **Staging** | **not provisioned** | see below |
| **Production** | **not provisioned** | see below |

### The activation step, which is an owner action

Staging and production have no bucket. Creating one means an account, a paid subscription and a
credential, and ADR-012's portability constraint means the choice is open: AWS S3, Cloudflare R2,
Backblaze B2, a self-hosted MinIO — anything that speaks the S3 protocol.

What the owner does, once, per environment:

1. create a **private** bucket (`eia-studio-staging`, `eia-studio-production`), no public access,
   **no public list**, server-side encryption on;
2. create a credential scoped to that bucket with **exactly** `GetObject`, `PutObject`,
   `HeadObject`, `DeleteObject` — and nothing else. In particular **no `ListBucket`** and no
   `ListAllMyBuckets`: the adapter issues those four commands and no other
   (`packages/application/src/storage/s3-adapter.ts`), so a credential that could enumerate the
   bucket would be able to do something the product never does — and a listing is the one place
   row level security does not reach (§1);
3. set the six variables — `STORAGE_PROVIDER=s3`, `STORAGE_BUCKET`, `STORAGE_REGION`,
   `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, and `STORAGE_ENDPOINT` unless it is AWS —
   **on both the web project and the worker service**, naming the **same bucket**. The web process
   writes the bytes and the worker reads them back; `memory`, the only alternative, is per process
   and is refused outside `local` and `test` anyway (TD-100);
4. nothing else. No migration, no deploy of a different build, no code change.

**Staging and production get different buckets and different credentials.** Sharing either would
mean a staging test could read or overwrite a real study's evidence, and a rotation in one
environment would silently break the other.

Until step 3 the deployment reports `NOT_CONFIGURED`, the upload panel says so, and the rest of the
product is unaffected. Secret **names** are in the repository; values never are.

### What to run the moment the credentials land

In this order, because each one depends on the one before:

| # | Check | Expected |
|---|---|---|
| 1 | `pnpm go-live:doctor` against that environment | *almacenamiento de objetos* reports the provider, not `NOT_CONFIGURED` |
| 2 | Anonymous `GET` of a known object key, with no credential | **403 or 404 — never 200** |
| 3 | Anonymous bucket listing | **refused** |
| 4 | Upload a PDF on *Documentos* | the row reads **En cola** |
| 5 | Wait for the worker | **Listo**, with passages and a locator |
| 6 | Search for a phrase from that PDF | a citation naming the **version** |
| 7 | *Descargar original* | the file comes back; `audit.log` holds `document.version.download_issued` **with no filename** |
| 8 | Upload the same bytes again | **answered as the existing version**, not a second one |
| 9 | Upload a `.docx` template under *Informes*, validate, activate, generate | a draft carrying the **BORRADOR** banner |
| 10 | Declare a field photograph, then retry the same command | **exactly one** `field_media` row |

Then assert, in the database: **zero duplicate `document_version`**, **zero duplicate `field_media`**,
**zero duplicate `generated_document`**, and **no object key containing a filename** — the key is six
segments and four UUIDs by construction (§1), and a key that carried a name would be a defect in the
key builder rather than in the bucket.

## 8. Tables

| Table | Shape | Rules |
|---|---|---|
| `app.upload_intent` | tenant, project, namespace, key, declared filename/type/size, ceiling, issuer, expiry, state | state `ISSUED → FINALIZED \| ABANDONED`; consumable exactly once, by trigger; FORCE RLS |
| `app.stored_object` | tenant, project, namespace, key, original filename, mime type, size, sha256, uploader | immutable after insert — `REVOKE UPDATE, DELETE` **and** a trigger; FORCE RLS |

Both carry `tenant_id`, `project_id` and the composite FK to `project`, and both are in the RLS
registry. The `REVOKE` is load-bearing: migration 0002 set `ALTER DEFAULT PRIVILEGES … GRANT SELECT,
INSERT, UPDATE, DELETE` in `app`, so every new table arrives with full DML (the argument of
SECURITY.md §10d).

## 9. What is deliberately not here yet

- **Field media.** The namespace, its permission and its formats exist; the `Media` row, the mobile
  offline queue, EXIF handling and retention are the next PR.
- **Extraction.** An uploaded version is `UPLOADED` / `PENDING_EXTRACTION` and has no passages.
- **Lifecycle rules and a portal export prefix.** SECURITY.md §7 describes both; neither has an
  object to apply to yet.
- **Antivirus.** Not present, not implied. See §4.
