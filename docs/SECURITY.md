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

- Key layout: `t/{tenant_id}/p/{project_id}/{module}/{object_id}/{filename}`; documents, media and
  exports are all under the project prefix; portal PDF exports live under
  `t/{tenant_id}/p/{project_id}/portal/` and are the only objects the portal can be given.
- No public buckets; every read/write is a short-lived presigned URL minted by a use-case after
  `requirePermission`. The DB stores keys; the UI never receives raw keys of other objects.
- Media EXIF: GPS is required data for field evidence and stays in the `Media` row; before any
  export to the portal or a deliverable, files are re-encoded without EXIF.
- Bucket per environment; server-side encryption; lifecycle rules for exports.

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

## 11. Client portal access (ADR-009)

- Separate route group, layout, session cookie, context type and DB role.
- Served from `portal.publication` rows only; no request-time reads of operational tables.
- Allowlist schema for the projection; a denylist test asserts that no forbidden concept
  (PII, phones, individual income, health, vulnerability, parcel codes, internal notes, raw AI
  classifications, quality findings, audit) can appear.
- Publication is an explicit, audited action by a role with `portal.publish`; withdrawing a
  publication is immediate.
- Portal PDF is generated from the same projection.
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

## 13. Security tests (acceptance)

Listed in TESTING_STRATEGY.md §5–§8: cross-tenant read/mutate, project id tampering, client
viewer isolation, disabled capability invocation, job isolation, RAG isolation, PII exposure,
escalation attempts, audit completeness.
