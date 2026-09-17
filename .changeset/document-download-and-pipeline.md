---
"@eia/domain": minor
"@eia/application": minor
"@eia/i18n": minor
"@eia/web": minor
---

A delivered file comes back down, and the pipeline is one test (ADR-034). Closes TD-093 and TD-100.

**Downloading an original.** *Descargar original* on a document's page is a link to a route that
resolves the version, checks `core.documents` and `documents.read`, and answers 303 to a presigned
GET the server minted with a 5-minute ceiling. Everything else — a version of another project, a
version whose bytes were never stored, an object outside the `documents` namespace, an
unauthenticated caller reaching the route directly — answers **404**, the same non-enumeration rule
the workspace routes already follow (ADR-016). Storage that is not configured answers 503 and says
so, rather than pretending the file is missing.

Every issuance writes `document.version.download_issued` with the document, the version label and
the privacy classification — never the filename, never the hash, never the key. SECURITY.md §9
already required auditing presigned issuance for PII objects, and a delivered study whose
classification is `REVIEW_REQUIRED` is exactly the object nobody has looked at yet, so every
issuance is recorded rather than only the ones somebody declared sensitive.

The link **does** contain the object key: a presigned GET addresses the object it signs, and the
alternative is streaming the bytes through the application, which is the cost ADR-031 declined for
uploads. What makes that acceptable is the key's own design — a namespace and four UUIDs, no
filename — so a pasted link discloses that a document exists and nothing about whose it is. Recorded
as TD-101, with the test asserting the actual shape rather than a comfortable claim about it.

**The pipeline is now one test.** `e2e/document-pipeline.spec.ts` uploads a PDF through the browser,
drains a **separate worker process** against the same MinIO the web application uses, and asserts the
row reaches *Listo*, the passage carries `p. 1`, the assistant's answer cites `v1 · p. 2`, and the
original comes back starting `%PDF`. Until now the browser wrote to one in-memory store and the
worker read from another, so nothing proved that bytes a browser sent are bytes a worker can read.
`pnpm e2e` starts the shared bucket first.

Also: `docs/STAGING_OPERATIONS.md`, the operator runbook for applying migrations 0034–0043 to
staging and activating a bucket there — both of which need credentials this repository does not have
and must not guess.

No migration. No new table, no RLS change, no schema impact.
