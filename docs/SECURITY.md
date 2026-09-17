# Security architecture

> Related: TENANCY.md, ADR-001, ADR-004, ADR-009, ADR-010, AI_GOVERNANCE.md. Nothing here is
> implemented; the tests listed in TESTING_STRATEGY.md are the acceptance criteria.
> Aligned with Gate 1 decisions D-015 (roles), D-016 (Better Auth scope), D-018 (privacy by
> design, legal review as a production readiness gate) and D-019 (portal forecast).

## 1. Threat model (summary)

| Threat | Primary controls |
|---|---|
| Cross-tenant read/write (bug or attacker changing ids) | URL-derived context, repository predicates, RLS, composite FKs, storage prefixes, vector RLS |
| Identity provider roles leaking into authorization | domain-owned memberships/roles/permissions; identity layer supplies `userId` only (ADR-010) |
| Horizontal escalation across projects inside a tenant | project membership check, `app.project_id` in RLS policies for project-scoped tables |
| Vertical escalation (member → admin, coordinator → owner) | role assignment rules, strict schemas, audited role changes, last-owner rule |
| Client viewer reaching internal data | separate surface, separate DB role, projection allowlist |
| Disabled capability invoked via API | `requireCapability` on all server entry points and jobs |
| Background job processing another tenant | job payload context + RLS in worker, no tenant-less DB sessions |
| PII leakage to LLM providers | `ai` ports typed to deidentified inputs; deidentification pipeline; provider allowlist |
| PII leakage to logs/traces/errors | redaction, no PII in span attributes, error scrubbing |
| Synthetic data presented as real | provenance regime + export guards (PROVENANCE.md) |
| Supply-chain / secrets | lockfile, dependency review, secrets in env only, presigned URLs short-lived |

## 2. Authentication

- Identity provider: Better Auth, approved provisionally at Gate 1 (D-016, ADR-010) for
  **identity, authentication and session management only**. Requirements: email + password with
  breach checks, magic link for invitations, TOTP 2FA (mandatory for OWNER/ADMIN/COORDINATOR per
  the prototype's security tab), session rotation, device list ("Sesiones activas · 9
  dispositivos · 3 con modo offline"), later SAML/OIDC SSO per tenant.
- The identity layer yields only `userId`. `TenantMembership`, `ProjectMembership`, `Role`,
  `Permission`, `ClientPortalGrant` and the capability resolver are EIA Studio domain concepts;
  Better Auth organisation roles, if any plugin is used, are never read for authorization.
- **Public self-signup is disabled** (IG0-H01): `emailAndPassword.disableSignUp = true`, so
  `/api/auth/sign-up/email` refuses anonymous identity creation. Identities are provisioned
  deliberately until the onboarding workflow makes creation of the identity, the application
  user, the `TenantMembership` and any `ProjectMembership` atomic or compensating. Sign-in for
  provisioned identities is unaffected, and disabling signup moves no authorization
  responsibility into the identity layer.
- Client portal users authenticate on the portal surface (invitation + magic link or password +
  optional 2FA); a portal session cannot be used on internal routes and vice versa (different
  cookie names, different context builders).
- Offline field devices (later) use device-bound refresh tokens with revocation from Tenant
  Settings.

## 3. Active tenant / project context

Defined in TENANCY.md §4. Additional rules:

- Slugs in URLs are looked up **within the user's memberships**; a valid slug the user has no
  membership for yields the same `permission denied` state as a non-existent one.
- `RequestContext` is created only by the context builder; use-case signatures require it, so a
  use-case cannot be called without a verified context (compile-time), and tests can construct
  contexts for tenant A and tenant B directly.

## 4. Server-side authorization

- `core/authz` exposes `requirePermission(ctx, key, resource?)` and `can(ctx, key, resource?)`.
- Resource policies add row-level rules on top of role permissions: e.g. `field.capture` only on
  own assignments; `pii.read` requires the project to have PII enabled and an accepted
  confidentiality notice; `portal.publish` requires `deliverables.approve` or COORDINATOR.
- Tenant roles (D-015): `OWNER` has implicit, computed, audited access to all projects; `ADMIN`
  administers tenant and projects but has **no implicit access to sensitive project data** (a
  `ProjectMembership` is required); `MEMBER` has no implicit administrative access. `CLIENT` is
  not a project role; client access exists only as `ClientPortalGrant`.
- UI receives `can(...)` results for rendering, but every server action re-checks.
- Denials produce `PermissionDenied { role, restrictedData }` for state 6 copy ("Tu rol Técnico de
  campo no incluye datos económicos individuales…") and are audited with request id.

## 5. PostgreSQL Row Level Security (ADR-004)

**What RLS is and is not (Implementation Gate 0, IG0-B01).** Row Level Security and the
privileged membership helpers defend against *application authorization bugs, forged tenant or
project identifiers in a request, and accidental cross-tenant access*: a missing predicate or an
untrusted `project_id` still cannot cross a tenant boundary. They are **not** a defence against
arbitrary SQL executed on the runtime connection after a full SQL-injection compromise, because
such an attacker already acts as the runtime role. The hardening in migration 0004 limits what
that would buy an attacker (boolean-only helpers, user read from the transaction-local setting,
no dynamic SQL, no object shadowing, no path to the privileged owner), but injection prevention
remains the application's job: parameterised queries, `strict()` schemas, repository predicates.

Principles:

1. **Roles**: `eia_migrator` (owner of schemas, runs migrations, never used by the app),
   `eia_app` (internal workspace and worker; RLS enforced, no BYPASSRLS), `eia_portal` (portal;
   USAGE only on `portal` schema, SELECT on projection tables, RLS by grant), `eia_readonly`
   (analytics/BI, later, RLS enforced).
2. **Session settings** inside a transaction: `SET LOCAL app.user_id`, `app.tenant_id`,
   `app.project_id` (nullable), `app.surface = 'internal'|'portal'|'job'`. Set by the DB access
   layer from the context; there is no code path that opens a transaction without them.
3. **Policies**: every tenant-owned table has `FORCE ROW LEVEL SECURITY` and a policy
   `tenant_id = current_setting('app.tenant_id', true)::uuid`. Project-scoped tables add
   `project_id = current_setting('app.project_id', true)::uuid OR app.project_id is null AND
   has_project_access(tenant_id, project_id)` for tenant-level listings (portfolio), where
   `has_project_access` is a `SECURITY DEFINER` function reading memberships.
4. **Missing setting denies**: `current_setting(..., true)` returns NULL → comparison is NULL →
   row denied. A connection without context sees nothing, by construction.
5. **Write policies** use `WITH CHECK` with the same predicates so that an insert with a foreign
   tenant id is rejected even if application code is wrong.
6. **PII schema** policies additionally require `current_setting('app.pii_access', true) = 'on'`,
   which the context builder sets only when `pii.read` was granted for this request.
7. **Connection pooling**: transaction-mode pooling is compatible because settings are `LOCAL`;
   session-mode pooling or `SET` without `LOCAL` is forbidden (lint rule + integration test that
   asserts settings reset between transactions).
8. **Migrations** create policies alongside tables in the same SQL file; a CI check fails if a
   table in the `app`, `pii`, `vec` or `portal` schema lacks RLS.

## 6. Background job isolation

- Enqueue happens inside the mutating transaction with `{ tenantId, projectId, actor, runId }`.
- Worker handlers receive a `JobContext` built from the payload after re-validating that the
  tenant and project exist and the capability is effective; the handler's DB access uses the same
  `SET LOCAL` pattern, so a job **cannot** read or write another tenant's rows.
- Jobs are keyed by run id (idempotent) and record progress on the run row.
- System-wide jobs (e.g. retention sweeps) iterate tenants and open one transaction per tenant.

## 7. Object storage isolation

> **Amended by ADR-031 (Production V1 Wave 2).** The key layout below originally ended
> `…/{object_id}/{filename}`. It no longer carries a filename — see §7a. Everything else in this
> section stands.

- Key layout: `t/{tenant_id}/p/{project_id}/{namespace}/{object_id}`; documents, media and
  exports are all under the project prefix; portal PDF exports live under
  `t/{tenant_id}/p/{project_id}/portal/` and are the only objects the portal can be given.
- No public buckets; every read/write is a short-lived presigned URL minted by a use-case after
  `requirePermission`. The DB stores keys; the UI never receives raw keys of other objects.
- Media EXIF: GPS is required data for field evidence and stays in the `Media` row; before any
  export to the portal or a deliverable, files are re-encoded without EXIF.
- Bucket per environment; server-side encryption; lifecycle rules for exports.

### 7a. A key carries no filename, and no client proposes one (ADR-031)

Two changes to the original layout, both for the same reason: a bucket listing is a flat text file
that operators, backups, the provider's console and support tickets all see, and it is the one place
RLS does not reach.

| Control | Mechanism |
|---|---|
| No name in the address | `t/{tenantId}/p/{projectId}/{namespace}/{objectId}` — six segments, four UUIDs, `namespace` ∈ {`documents`, `field-media`}. No filename, no extension, no document code, no date. A delivered file can be called *Levantamiento predio 41 — Sra. Rosa Chamba.pdf* |
| The name is kept where reading it is authorized | on `stored_object` and `document_version`, under RLS, and restored on the download link as a `Content-Disposition` name |
| The server mints the key | `buildObjectKey` takes no string a person typed; `createUploadIntent` accepts a namespace, a filename, a type and a size, and returns a URL. A client that can name a key can name another tenant's |
| The key is re-checked on the way back | `assertObjectKeyBelongsTo` parses a stored key against the caller's own tenant, project and namespace at finalize, so a row written by an older, wider version could not be finalized into this project |
| An upload is not trusted because the client says so | `finalizeUpload` asks the provider: is there an object, of an acceptable size, whose first bytes are the declared format's signature? The SHA-256 is computed from the bytes read back. `ETag` is recorded as the provider's entity tag and **never** treated as a content hash |
| Nothing is stored for a format we do not accept | extension, declared MIME type and signature must agree, against a two-format allowlist per namespace. A `.docx` is a ZIP, and `ARCHIVE_LIMITS` bounds what extraction may read out of it |
| Deduplication never crosses a tenant | the file hash is matched within one project and namespace: whether another firm holds the same file is not a fact this product may reveal |
| Storage off is a state, not a crash | `resolveStorageAvailability` (the shape of IG4-001): an unset provider is *unavailable*, `memory` is refused outside `local` and `test`, and there is no fallback — a file that is not where the database says it is would be discovered by whoever needed it most |
| Both tables | `upload_intent` (consumable exactly once, by trigger) and `stored_object` (immutable by `REVOKE UPDATE, DELETE` **and** a trigger), FORCE RLS, tenant/project columns and the composite FK |

### 7b. Reading an uploaded file (ADR-033)

Extraction is the first code in this product that parses **untrusted binary input**, and the
controls are about what it will not do with it.

| Control | Mechanism |
|---|---|
| Nothing is executed | pdf.js runs with `isEvalSupported: false`, no worker, `disableFontFace`, `useSystemFonts: false`. A PDF has a scripting layer; none of it runs, no font is fetched from a network and no external resource is resolved |
| A DOCX's archive is bounded before it is expanded | `ARCHIVE_LIMITS` is checked against every entry's **declared** size as the central directory is walked — which is where a zip bomb lies — and only `word/document.xml` and `word/styles.xml` are ever decompressed. The macro project is not read at all |
| A file is bounded in what it may consume | `PDF_LIMITS`: 2 000 pages and 12 M characters. A page count is not bounded by a file's size, and a malformed one can declare a great many |
| A failure is a state, not a crash | a corrupt or encrypted file becomes `FAILED` with bounded operational text — never a stack trace, never the document's words. The worker keeps running |
| The job holds no identity of its own | `app.claim_document_extraction` is SECURITY DEFINER, owned by `eia_policy`, and returns **four uuids**: version, tenant, project, uploader. No object key, no filename, no page of text. The worker then opens an ordinary RLS transaction *as the uploader*, so a revoked membership makes the job fail safely |
| A worker with no storage never claims | claiming and then failing at the first fetch would drain the queue and mark every document `FAILED` over a missing environment variable (IG4-001's rule, one layer across) |
| Logs | identifiers, a state and counts. A document's text never reaches a log line |
| No model | nothing in this path calls one. Retrieval remains PostgreSQL full-text (ADR-021) |

**A scanned PDF is `REQUIRES_OCR` and writes no chunk**, so it can never be cited — and OCR is not
built (TD-098), because it means an external **processor** handling a study's documents and §10a's
review has assessed no such vendor.

### 7c. A consultancy's own template, and the document produced from it (ADR-036)

A template is untrusted binary input *and* a decision about what a deliverable will say, so the
controls are in both directions.

| Control | Mechanism |
|---|---|
| No code in a template | the renderer evaluates nothing (`docx-templates`, which runs JavaScript from the template, was rejected for this); `.doc` and `.docm` are refused by declared type; **`word/vbaProject.bin` is refused inside the archive**, because a `.docm` renamed `.docx` presents the same ZIP signature |
| A container that is not a Word document | `word/document.xml` must be present: `PK\x03\x04` is every ZIP there is |
| An archive that lies about its size | ADR-033's `ARCHIVE_LIMITS`, against declared sizes as the central directory is walked |
| No raw XML, image, chart or link from a template | the renderer's plugin list is replaced with text and repetition only |
| The template cannot choose what it reads | the library's default resolver is a path traversal over the data object; it is **replaced** by one that answers only from the closed placeholder registry, and the data object handed to the library is empty |
| No personal data, no proposal, no internal identifier | the registry is an enumeration, so those absences are asserted by a test rather than intended |
| A vulnerable XML parser underneath | the renderer pins `@xmldom/xmldom@0.8.13`, which carries ten open advisories including quadratic-time parsing reachable from an uploaded file; a workspace `pnpm` override lifts it to the advisory-clean `0.8.15` |
| Absence is not a number | a placeholder whose absence blocks stops the document; one that tolerates absence prints an explicit localized *no value*, never `0` and never a model's guess |
| Every output says what it is | the draft banner is a required placeholder *and* is verified in the rendered text; a document without it is refused rather than delivered |
| An activated version is frozen | which file a version is cannot change, by trigger; a corrected template is the next version |
| Namespaces are not mixed | `templates` and `generated` are separate from `documents`; a generated draft is unreachable by a query written for the corpus |
| Audit | `templates.version.uploaded`, `.activated`, `.document.generated`, `.document.download_issued` — the template's code, the label, the locale and counts. **Never the filename**, never the rendered bytes, never a value the document printed |

## 8. Vector / RAG isolation

- Chunk embeddings live in `vec.document_chunk_embedding (tenant_id, project_id, chunk_id,
  embedding)` with the same RLS policies.
- Retrieval queries always include `tenant_id = … AND project_id = …` predicates in addition to
  RLS, and the retriever runs inside the request transaction.
- Chunks derived from documents flagged `contains_pii` are stored redacted (AI_GOVERNANCE.md §4);
  the raw text stays in `documents` under PII rules.
- Cross-project retrieval inside a tenant (e.g. reuse of a legal framework) is **not** allowed by
  default; if a future feature needs it, it is an explicit, audited, capability-guarded action.

## 9. Audit log

- `audit.log` is append-only (no UPDATE/DELETE grants for `eia_app`), written in the same
  transaction as the mutation.
- Always audited: sign-in events, role and membership changes, capability toggles, configuration
  changes, PII reads and exports (with reason), publications to the portal, specialist decisions,
  taxonomy approvals, imports, deletes, presigned URL issuance for PII objects.
- Never exposed to the portal; readable by `audit.read` (owner/admin) in Tenant Settings ›
  Seguridad › "Ver registro".
- Retention independent from data retention; stored without PII values (ids only).

## 10. PII isolation

- Identified data (names, phones, ID numbers, individual income, health, individual
  vulnerability indicators, signatures, precise household GPS) lives in the `pii` schema, linked
  by pseudonymous ids (`Respondent.pseudonym`).
- Questions in a `SurveyVersion` are flagged `pii: true`; their answers are stored in `pii`
  tables, never in `app.answer`.
- Analytical tables and read models contain only pseudonyms and aggregates; the social analytics
  screens work on de-identified data; the Parcel Workspace shows identified data only to roles
  with `pii.read` (state 6 otherwise), and every export of identified data is audited with a
  reason (prototype Security tab).
- Retention: tenant policy "anonymise personal data N months after project close" (prototype:
  24) runs as a per-tenant job that replaces identifiers and keeps aggregates; provenance records
  note the anonymisation run (transformation `ANONYMIZED` appended).

## 10b. Field responses: row ownership inside a project (Slice 3)

Individual survey responses are the first data in this product where *being on the project* is
not enough. A `FIELD_TECHNICIAN` must be able to do their own work and must not be able to browse
the project's households; a `GIS_SPECIALIST` may see that a parcel was visited without reading
what was answered there.

| Layer | Control |
|---|---|
| Permission | `field.responses.read` is separate from `field.read` (TENANCY.md §3.1) and is not held by FIELD_TECHNICIAN or GIS_SPECIALIST |
| Application | `withFieldContext` sets `app.field_responses_access` from the resolved permission; use-cases check ownership before every mutation |
| Row level | `field_assignment`, `field_visit`, `survey_instance` and `survey_answer` require *(this row is mine) OR `app.can_read_field_responses()`* in addition to tenant, project and project access |
| Route | an assignment that is not the caller's own answers **404**, not a denial: a distinguishable error would confirm the row exists, which is what someone editing ids wants to learn |
| Definition | the questionnaire itself is not an individual's data and stays readable to the project, so a technician can read the form they must fill in |

`app.field_responses_access` is transaction-local and set only after `requirePermission` has
passed; forging it would still leave every other conjunct in each policy — tenant, project,
membership — in force, and a caller able to set session settings arbitrarily already holds the
runtime role (§5, IG0-B01).

The demo questionnaire collects **no** personal data: no names, identity numbers, phone numbers,
email addresses, health or disability data, individual income, or precise household coordinates.
Answers are synthetic and labelled `DEMO_SIMULATION`. A visit's location is the technician's own
position at the time of the visit, captured only with the browser's permission and recorded as
`denied` or `unavailable` when there is none — never fabricated, and never a household's address.
Answer payloads are not written to logs.

## 10c. Sending text to a language model (Slice 4)

This is the first slice where data leaves the system for a third party, and the controls are
deliberately about the **data**, not about the person asking.

| Control | Mechanism |
|---|---|
| Demo-only gate | `assertAiProcessingAllowed` refuses any answer whose provenance regime is not `DEMO_SIMULATION`. Checked when a run is created *and* again in the worker at the moment the text would leave. A specialist with every permission cannot send a `HISTORICAL_OBSERVED` or `LIVE_OPERATIONAL` answer |
| Not a hidden button | the gate is in the domain, on the path every caller takes; the integration test asserts the classifier port was **never invoked** for a refused run |
| Data minimisation | the classifier's input type carries the response text and the taxonomy definition, and has nowhere to put a respondent, a technician, a parcel code, a coordinate, a visit or another answer |
| Prompt injection | response text arrives inside a delimited block, the instruction says it cannot redefine the task, and the output schema admits only category codes of one published taxonomy version. An invented code is a **failed** classification, never coerced to `OTHER` |
| No agency | the classifier has no tools, no retrieval, no browsing, no filesystem and no database. One text in, one structured answer out |
| No reasoning stored | chain-of-thought is neither requested nor persisted; nor is the raw provider response body. A plausible machine-written rationale for a coding of what a person said is exactly the artefact that would later be quoted as evidence |
| Vendor boundary | one narrow port (`OpenTextClassifier`); the live adapter is the AI SDK through the Vercel AI Gateway, selected by explicit configuration with **no fallback** — a misconfigured environment fails rather than fabricating codings |
| Logs | answer text never reaches a log line; the worker logs identifiers and statuses, and a classification's stored `error` is bounded operational text |
| Model output is a proposal | it is never the validated coding, never overwrites the answer, and never enters a validated figure without a human decision (ADR-019) |

This restriction stands until the privacy, legal and vendor review of §10a explicitly authorises
real data. Lifting it is a decision recorded there, not a configuration change here.

### 10c.1 Which classifier runs where, and why unset is not `fake` (IG4-001)

A second question sits beside "may this text leave?": **what answered?** A proposal written by a
keyword matcher and a proposal written by a model are the same shape once they are rows, so a
persistent environment that ran the deterministic fake would be producing an artefact nobody could
afterwards tell apart from a real one. `SOCIAL_CLASSIFIER` therefore has **no default**, and one
domain function (`resolveClassifierAvailability`) decides for the web app, the worker and the
operator scripts alike.

| `APP_ENV` | unset | `fake` | `ai-gateway`, no credential | `ai-gateway`, credential |
|---|---|---|---|---|
| `local`, `test` | unavailable | **available** | `BLOCKED_EXTERNAL_CONFIG` | available (live) |
| anything else | unavailable | **refused** | `BLOCKED_EXTERNAL_CONFIG` | available (live) |

- **Unknown environments are persistent.** The predicate names `local` and `test`; everything else,
  including a misspelt value, is persistent. A typo loses assisted coding rather than gaining a
  fake one.
- **Unavailable is not an outage.** Deterministic tabulation never asks a model for a number, so it
  keeps working; only the coding half stops, and the surface says which of the three reasons it is.
- **Nothing unprocessable is written.** `startClassificationRun` refuses before it reads an answer,
  so a `ClassificationRun` that no worker could ever process does not exist. A worker whose
  classifier is unavailable never constructs the consumer, so it never claims.
- **No process refuses to boot over it.** A missing gateway credential is a reported state, not a
  startup failure: taking the whole deployment down over a feature it may not use would be a worse
  outcome than losing that feature.

## 10f. Sending a delivered study's passages to a model (Wave 3, ADR-035)

The second time data leaves this system for a third party, and the first time what leaves is a
**client's delivered document** rather than a synthetic demo answer. The controls are again about
the data rather than the person asking.

| Control | Mechanism |
|---|---|
| Privacy gate | only a `DocumentVersion` classified `NO_PERSONAL_DATA_KNOWN`, on a document not flagged `contains_pii`, may be read by a model. `REVIEW_REQUIRED` is the default for every upload and means *nobody has looked*; treating it as safe would send exactly the documents nobody has checked |
| Refused, never filtered | a corpus with one ineligible version stops the **whole** run, and the refusal names every document that blocked it. Dropping them and reviewing the rest would make "no candidates in the social chapter" mean "the social chapter was never read", with nothing on screen saying so |
| The refusal is audited | `documents.review.run_refused`, written in its own transaction so it survives the refusal it records. A refusal that left no trace is indistinguishable from a run nobody attempted |
| Data minimisation | what leaves is passage **text**, and nothing else: no filename, no document code, no uploader, no project name, no survey answer, no parcel. The prompt is built from `text` alone |
| The corpus is recorded | `document_review_source` stores which versions a run read and the classification each carried *at the time*, so "what did this run actually look at?" is answerable from the row rather than re-derived from a corpus that has since changed |
| No agency | the reviewer has no tools, no retrieval of its own, no browsing, no filesystem and no database. Passages in, a bounded structured object out |
| Prompt injection | passage text arrives delimited and the instruction says nothing inside it can change the task. What actually holds is that there is no capability to grant: the worst a hostile paragraph can achieve is a candidate a specialist reads and dismisses, beside the passages it cites |
| Bounded output | a closed schema, closed passage indices, bounded lengths, at most twelve candidates. A candidate citing a passage the model never received is refused and counted, never dropped |
| No compliance conclusion | invariant 11's forbidden vocabulary, in both languages, over every field of every candidate |
| No reasoning stored | chain-of-thought is neither requested nor persisted, and neither is the raw provider response body |
| Vendor boundary | one narrow port, one selector (`DOCUMENT_REVIEWER`) with **no default** and no fallback (IG4-001); a gateway without its credential is `BLOCKED_EXTERNAL_CONFIG` |
| Logs | identifiers and counts. A passage never reaches a log line, and neither does a candidate's text |
| Model output is a proposal | it is never a finding, never enters a report, and cannot be accepted at all unless it names two sources (ADR-035 §7) |

This restriction stands until the privacy, legal and vendor review of §10a explicitly authorises
real data. `DOCUMENT_REVIEWER` is unset in every environment this repository controls.

## 10d. A specialist decision, and a citation nobody can check (Slice 5)

Two controls, and neither is about isolation. They protect the record from *us*.

| Control | Mechanism |
|---|---|
| A decision is permanent | `specialist_review` is append-only: `REVOKE UPDATE, DELETE` from `eia_app`, plus BEFORE UPDATE/DELETE triggers so the owning role cannot either. A change of mind is another row. A dismissal that could be quietly rewritten would leave the study carrying a conclusion nobody reached, attributed to somebody who did not reach it |
| The revoke is load-bearing | migration 0002 set `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE`, so every new table in `app` arrives with full DML. A narrower `GRANT` beside it changes nothing; only the explicit `REVOKE` does. Asserted on staging by privilege introspection, not inferred |
| A justification is mandatory | CHECK `length(btrim(justification)) >= 12`, so "ok" cannot stand as the recorded reason a finding about a study was settled |
| A finding never shows one side | deferred CONSTRAINT TRIGGER: exactly one `SOURCE_A` and one `SOURCE_B` at commit. A one-sided finding is an assertion, and this module does not make assertions |
| No fabricated citation | a CHECK refuses `source_kind = 'DOCUMENT_VERSION'` while no document has been ingested, and no locator carries a page number. Inventing a page in the one field whose purpose is verification is the worst thing this module could do; the check is dropped by the migration that adds document versions (ADR-020 §5–6) |
| No compliance conclusion | the permitted/forbidden vocabulary of invariant 11 is data in the domain, asserted over the rule catalogue's copy, over every generated finding, and — on staging — over whatever is actually stored |
| No special-category data | the vulnerability rule compares two statements from the **corpus**, never a conclusion against survey records. A vulnerability indicator attached to a household is special-category personal data, the demo questionnaire collects none, and adding a field so a rule could count it would be exactly the "small exception for a demo" the compliance gate exists to prevent |

## 10e. A technician's device (Production V1, Wave 1, ADR-028)

EIA Field is the first EIA Studio client that is not a browser, and the first that holds project
data on hardware the firm does not control. The controls are about the **device** and the **wire**.

| Control | Mechanism |
|---|---|
| No secret in the bundle | A React Native bundle is readable by whoever holds the phone. There is no service token, no signing key and no shared credential: the only credential is a session the technician creates by signing in. `apps/field/test/bundle-safety.test.ts` fails on anything shaped like a key |
| No server code in the bundle | No driver, no ORM, no application layer, no `node:` builtin. The app imports `@eia/domain/mobile` — a narrow entry point whose import graph is walked by `packages/domain/test/purity.test.ts` — and `@eia/field-sync-contract`, which depends on zod alone |
| Encrypted at rest | `expo-sqlite` with SQLCipher, keyed by 32 random bytes generated once per installation and held in `expo-secure-store` (Keychain / Android Keystore). Never derived from a password, never transmitted, never logged |
| Encryption is verified, not assumed | `PRAGMA cipher_version` is read after opening and the application **refuses to continue** if it is empty. On a runtime without the extension `PRAGMA key` silently does nothing, and answers would sit in the clear while the application believed otherwise |
| Minimal local dataset | One technician's current assignments, the published questionnaire, and their own captures. No other technician, no respondent, no finding, no document, no geometry, no coordinate of anyone's home |
| Identity is the server's | The device never sends a user id and the server never reads one. `resolveAccessContext` builds the `RequestContext` from the session, exactly as a page does |
| Authorization is still RLS | Every mobile route goes through the same use-cases and the same row-level policies. A technician holds neither `field.read` nor `field.responses.read`, so a forged request still sees only their own rows |
| Non-enumeration | A tenant or project the caller cannot see answers **404**, never 403 — the same rule the workspace routes follow (ADR-016) |
| A receipt is the caller's own | `app.field_sync_receipt` adds `user_id = app.current_user_id()` to the ordinary predicate, is write-once by grant **and** trigger, and cannot be read across technicians |
| Trusted origins | Better Auth gains exactly one new origin, the literal `eiafield://`. No wildcard scheme, and no scheme we do not control |
| Logs | The sync error log stores bounded operational text, truncated, and never a payload. The diagnostics screen shows counts and versions — no answers, no identifiers of people, no tokens — so it is safe to photograph and send to support |
| Sign-out | Discards the session, the database key and the database file. Refused while the outbox is non-empty, because losing a day of field work to a stray tap is not a trade the application makes on somebody's behalf |
| Environment separation | The API URL is build-time configuration (`EXPO_PUBLIC_API_URL`), not a runtime setting. A field application that can be repointed from its own settings screen is one tap away from writing demo answers into a real study |
| No model call | This wave has no AI requirement and no code path to one. No survey data leaves for a model from the device or from the sync routes |

### 10e.1 A photograph on a technician's phone (Production V1 Wave 2, ADR-032)

The device now holds files as well as rows, and a photograph of a parcel can contain a person, a
house number or the inside of a home.

| Control | Mechanism |
|---|---|
| The camera, never the library | `expo-image-picker` is configured with `photosPermission: false` and the application calls `launchCameraAsync` only. A picker over the whole device is a picker over everything else on it |
| No kind for identified data | four kinds — `parcel`, `affectation`, `access`, `other` — and deliberately no `document` and no `signature`. Photographing an identity card or a signed sheet is collecting identified personal data the compliance gate of §10a has not authorised |
| Files live where the application can protect them | copied out of the picker's cache into the app's own documents directory at capture. The camera roll is the operating system's and a backup would copy it off the device |
| Row ownership | `field_media`'s select policy is `survey_instance`'s — *this row is mine, or I hold `field.responses.read`*. Its **insert** policy has no such escape: a caller may only declare in their own name |
| Written once | `REVOKE UPDATE, DELETE` **and** a trigger. What a photograph is of, and when, are statements a technician made at the shutter |
| No session reaches the storage vendor | the PUT carries the provider's signature and nothing of ours. Sending a session cookie to a storage vendor would hand them a credential for this product (§7) |
| The local file is the last thing to go | released only by the server acknowledging the row — never by the PUT returning 200 — through one predicate, `mayDeleteLocalFile` |
| Nothing is altered on capture | no re-encode, no resize, no EXIF strip. A device that silently altered evidence would be producing something the technician did not take; stripping belongs where a file is exported (§7) |
| Never automatically onward | not to the client portal, not to a model provider, not to the document corpus, not to a map. Each prevented by a type or a query with nowhere to put a photograph, and each asserted by a test (ADR-032 §3) |
| Audit | `field.media.declared` records the visit and the kind. Never the technician's free-text note and never the coordinates |

**The limitation, recorded rather than mitigated:** a device with no connectivity cannot learn that
an account was suspended or an assignment reassigned. Revocation takes effect at the next server
contact. The product's answer is a short, derived, visible window — `min(session expiry, now + 7
days)` with a one-hour floor — after which the device stops offering *new* capture and keeps
everything already captured.

## 10a. Privacy by design and the compliance gate (Gate 1 D-018)

Before **production ingestion of any real personal data**, the project requires a specific
compliance review under Ecuador's personal-data framework (LOPDP and its regulation/authority,
SPDP). This documentation does not draw legal conclusions; it records what the architecture must
support so that the review has something to assess. **Legal review is a production readiness
gate**, listed in IMPLEMENTATION_PLAN.md; until it passes, demo and test data remain synthetic,
anonymised or aggregated unless explicitly approved otherwise.

Capabilities the architecture supports now (entities in DATA_MODEL.md §3.9):

| Requirement | Architectural support |
|---|---|
| Data inventory | `DataInventoryEntry` per dataset/schema/bucket prefix with data categories and subjects; generated from the survey versions' PII flags and the `pii` schema |
| Purpose | `ProcessingPurpose` linked to inventory entries; recorded on imports and survey templates |
| Retention | `RetentionPolicy` per inventory entry (trigger, months, action) executed by the audited retention job |
| Auditability | `audit.log` for every PII read/export/anonymisation with reason and actor |
| Deidentification | gateway + `DeidentificationRun` (AI_GOVERNANCE.md §4); `ANONYMIZED` transformation facet on provenance |
| Processor / vendor registry | `ProcessorRegistryEntry` (vendor, service, region, allowed data categories, contract reference); `ai` adapters can only target registered vendors |
| Legal basis / consent metadata | `LegalBasisRecord` / `ConsentRecord` per respondent when applicable (signed sheet, minute reference, withdrawal) |
| Data-subject rights (future) | `DataSubjectRequest` workflow placeholder; pseudonymous ids make lookup and erasure/anonymisation feasible per subject |
| AI vendor governance | registry flag `ai_vendor`, allowed model families and regions; provider/model/prompt versions recorded on every AI output (AI_GOVERNANCE.md) |
| DPIA / risk-assessment metadata | `RiskAssessmentRecord` per tenant/project with status and reference document |

What the code base must not do: assert compliance, compute legal conclusions, or treat the
presence of these records as approval. The compliance owner (tenant and/or EIA Studio) decides;
the product records.

## 11. Client portal access (ADR-009, ADR-027)

- Separate route group, layout, session cookie, context type and DB role.
- Served from published projection rows only; no request-time reads of operational tables.
- Allowlist schema for the projection; a denylist test asserts that no forbidden concept
  (PII, phones, individual income, health, vulnerability, parcel codes, internal notes, raw AI
  classifications, quality findings, audit) can appear.
- Publication is an explicit, audited action by a role with `portal.publish`; withdrawing a
  publication is immediate.
- Portal PDF is generated from the same projection.

### 11a. What is built, and what the internal preview means (ADR-027)

The published half exists; the external half does not, and the difference is a security boundary
rather than a milestone.

| Control | Mechanism |
|---|---|
| The projection | `portal.client_publication` in its own schema: immutable by `REVOKE UPDATE, DELETE` *and* a trigger, under the ordinary tenant/project/access predicate |
| The payload | composed from a closed allowlist (`clientPublicationPayloadSchema`), never filtered from an operational record; a second scan refuses a forbidden concept smuggled into free text |
| Simulated data | `assertPublishableRegime` refuses `DEMO_SIMULATION` outright, and admits `LIVE_OPERATIONAL` only as an aggregate the caller declares publication-safe |
| No operational read | the client surface issues statements against `portal.client_publication` only; an integration test observes the SQL on the wire |
| Two grants | `portal.preview` opens the draft and the client view; `portal.publish` decides. A REVIEWER holds the first and not the second |
| `eia_portal` | **granted nothing.** There is no external client session, so the role has no caller; a role given SELECT to look implemented is surface with nobody behind it (TD-005) |
| The preview route | `/portal/:tenant/:project` requires an ordinary authenticated **internal** session with `portal.preview`, and says so in a strip outside the client content. No share token, no unguessable URL, no public hostname (TD-078) |
| Audit | `portal.publication.published` records the version and the figure count. Never the payload |
- Forecast (D-019): `client.portal.show_forecast = false` by default. When enabled for a
  project, only explicitly published `ForecastSnapshot`s enter the publication, each with its
  provenance record, calculation time, algorithm version, assumptions and clear projection
  wording; a `DEMO_SIMULATION` snapshot can never be published as client progress (validator
  rejects it).

## 12. Privilege escalation prevention

See TENANCY.md §6. Additional technical controls: CSRF protection on server actions, strict CSP,
same-site cookies, rate limits, dependency audit in CI, secrets never in the repo, presigned URL
TTL ≤ 15 minutes, admin actions require recent re-authentication (step-up) for ownership transfer
and PII export.

## 12a. Test tooling must not be able to destroy a real environment (IG3-001)

Isolation controls protect tenants from each other. This one protects an environment from our own
tooling, and it belongs here because the failure mode is the same shape: a helper that operates on
whatever database it is handed, trusted to be pointed at the right one.

The integration suite truncates tenant and identity tables between files. Pointed at persistent
staging it removed the synthetic identities the demo campaign assigns work to, and the campaign
re-seeded with zero assignments. Nothing crossed a tenant boundary and no data of consequence was
lost — staging holds only synthetic, PII-free demo data — but an environment that a reviewer is
expected to log in to stopped working, and the remedy on offer was "re-provision afterwards",
which is not a contract.

| Control | Mechanism |
|---|---|
| Destructive helpers refuse unknown databases | `assertEphemeralTestDatabase` verifies a marker table whose token is generated per run by the Testcontainers setup; every other outcome refuses (fail closed) |
| Identification is positive, not heuristic | not hostname, database name, `NODE_ENV` or a "not production" flag — a stamp written by the process that created the throwaway container |
| No override | no flag, argument or environment variable makes the check pass; the external-database mode that allowed it (`EIA_TEST_MIGRATOR_URL`) is removed and now fails the run |
| Separate command and config | `pnpm test:staging` with its own vitest config, so `pnpm test` cannot reach a persistent environment |
| Staging writes | only inside transactions that always `ROLLBACK`; no truncate, no drop, no seed, no fixture repair |
| Both sides asserted | the staging suite fails if the environment carries the ephemeral marker; the integration suite fails if it does not |
| Local development | `pnpm e2e:prepare` reconciles identities (including the credential) and never wipes; emptying a local database is the separate, guarded `pnpm db:reset:local` |
| Credentials | the synthetic demo password is supplied through `DEMO_USER_PASSWORD` in the environment only — never committed, never printed, never written to a log or to documentation |

## 13. Security tests (acceptance)

Listed in TESTING_STRATEGY.md §5–§8: cross-tenant read/mutate, project id tampering, client
viewer isolation, disabled capability invocation, job isolation, RAG isolation, PII exposure,
escalation attempts, audit completeness.
