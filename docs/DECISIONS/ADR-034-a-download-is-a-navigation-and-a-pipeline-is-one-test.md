# ADR-034 — A download is a navigation, and a pipeline nobody tests end to end is a pipeline in halves

- Status: Accepted
- Date: 17 September 2026
- Related: ADR-031 (object storage), ADR-033 (extraction), ADR-012 (hosting), ADR-016 (route
  outcomes), `docs/SECURITY.md` §7 and §9, `docs/OBJECT_STORAGE.md`.
- Closes: TD-093, TD-100.

## Context

Wave 2 built an upload path, a versioning model and an extraction worker, and left two gaps that
are the same gap seen from two sides.

**A file could be put in and never taken out.** `presignStoredObjectDownload` existed, was
permission-checked and was tested; no button called it, so the one thing a consultant most obviously
wants from a document management surface — *give me the file* — was not there (TD-093).

**No test followed a file the whole way.** The integration suite proved the worker against real
MinIO; the e2e suite proved the browser against an in-memory store that lives in one process. Each
half was real and the join was not, so the arrangement that actually ships — a web process that
writes bytes and a worker process that reads them — was the one arrangement nothing exercised
(TD-100).

## Decision

### 1. A download is a route, and the page holds a route rather than a link

`GET …/documents/:code/download/:versionId` resolves the caller's context, calls
`issueDocumentDownload`, and **redirects** to the provider's signed URL.

A server action returning the URL was the alternative, and it is worse: it puts a five-minute
bearer credential into the page, into the client-side router cache, and into whatever copies the
page. A redirect is followed once by the browser and never becomes a value the document holds.

### 2. What the link discloses, stated exactly rather than claimed away

A presigned S3 GET **contains the object key** — the path addresses the object, the query string
carries the signature. There is no way to sign a fetch of an object without naming it, short of
streaming the bytes through this application, which is the cost ADR-031 declined for uploads and
declines here for the same reason.

What makes that acceptable is the key's own design: `t/{tenantId}/p/{projectId}/documents/{objectId}`
is a namespace and four UUIDs, so a link pasted into a chat discloses *that a document exists* and
nothing about whose it is — no filename, no code, no date, no person. SECURITY.md §7's rule is that
**the UI never receives raw keys of other objects**, and the page satisfies it.

This ADR records the precise claim because the first draft of the code asserted something stronger
and false, and a test caught it.

### 3. Every issuance is audited, not only the sensitive ones

SECURITY.md §9 requires auditing "presigned URL issuance for PII objects". A delivered study is
exactly that kind of object, and its `privacy_classification` is *a claim somebody made* —
`REVIEW_REQUIRED` means nobody has looked (ADR-031 §8). Waiting for a classification before
auditing would mean auditing least where least is known, so `document.version.download_issued`
records every one.

It records the document, the version label and the privacy claim. Never the filename — which can
name a person — never the key, never the hash, never the link.

### 4. Not found, for three different reasons

A version that does not exist, one belonging to another project, and one with no file all answer
**404**. A caller editing identifiers must not be able to tell them apart, which is the rule
ADR-016 set for routes and SECURITY.md §10b set for field responses.

A version with no file is not hypothetical: every document in the pilot corpus is one, because its
text was transcribed by hand and the original never entered the system. The surface says so in
words rather than offering a button that fails.

### 5. Storage unavailable is 503, not 404

The file exists and this deployment cannot reach it (ADR-031 §5). 404 would say the document is not
there, which is a different and false statement.

### 6. One store for the whole e2e stack, and a worker that is a process

`pnpm e2e` starts one MinIO (`tooling/scripts/e2e-storage.mjs`) and the Playwright web servers use
it. `e2e/document-pipeline.spec.ts` then follows a file all the way:

```
browser upload → intent → MinIO → QUEUED → worker → READY → chunks → search → citation → download
```

The worker step runs `tooling/scripts/extract-once.ts` **as a separate process**, calling the exact
two functions `ExtractionConsumer` calls — `claimNextExtraction`, then
`processDocumentExtraction` — with no test-only path between them. A separate process is not a
convenience: the property being proved is that bytes one process wrote are bytes another can read,
and that cannot be proved inside one.

It **drains** rather than claiming once, because the queue is ordered by upload time and this suite
is not the only thing that puts work in it.

Plain `docker run` rather than Testcontainers for the store, because this container must outlive
the process that created it, and tying a container's life to a test run is Testcontainers' whole
purpose.

**Absent the container the suite still runs**: the pipeline spec skips with the reason on screen,
and every other spec keeps the in-memory store. A developer who has not started Docker loses one
test, not the suite.

## Consequences

- TD-093 and TD-100 close.
- The e2e suite now needs Docker for one spec. CI already runs Testcontainers, so the capability is
  present; the skip keeps a laptop without it working.
- `@eia/testing` gains a `/documents` subpath, because the package barrel reaches `@eia/db` — ESM —
  and the Playwright runner transpiles to CommonJS. The file builders depend on `fflate` alone.
- The download route is the first place this product issues a credential to a browser. Its TTL is
  five minutes (`DOWNLOAD_LINK_TTL_SECONDS`), inside SECURITY.md §12's fifteen.

## Alternatives considered

**Stream the bytes through the application** so the key never reaches the browser. Rejected: a
120 MB study through a serverless function is the cost presigned URLs exist to avoid, and the key
names nobody. Recorded here as the thing to revisit if a tenant's policy ever forbids the object
path being visible at all.

**A server action returning the URL.** Rejected — §1.

**Start MinIO from Playwright's `globalSetup`.** Rejected: the web servers need its address in
their environment, and the ordering between `globalSetup` and `webServer` is a detail of the runner
rather than something this repository should depend on. A script that runs first has no ordering.

**Run the whole worker process for the pipeline test.** Rejected: starting it, waiting for it to
poll, and stopping it are three places for a flake that says nothing about the product. The loop is
covered by the integration suite; what the pipeline needs is the claim and the read.
