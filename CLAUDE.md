# CLAUDE.md — EIA Studio

EIA Studio is a multi-tenant B2B SaaS for environmental consulting firms: field capture, parcels,
surveys, social analysis with human-in-the-loop AI, quality review and client reporting.

**Current phase: PRODUCTION V1 (authorised 15 Sep 2026); the real-data and productization wave that preceded it is logged in `docs/DEVELOPMENT_WAVE_LOG.md`.** The sustained MVP
development wave that preceded it (authorised 3 Sep 2026) delivered Slice 0 (SaaS
foundation), Slice 0.5 (staging foundation), Slice 1 (product shell, Portfolio, Command Center,
provenance drawer), Slice 2 (GIS / Parcel Explorer, Parcel Workspace), Slice 3 (FieldFlow, versioned
questionnaires, typed answers), Slice 4 (Social Intelligence / human-in-the-loop), Slice 5 (Quality
Gate), Slice 6 (document intelligence + RAG) and **Slice 7 (assisted report generation)** are merged
into `main`; Implementation Gates 0–4 and Staging Gate 0.5 are closed, and the MVP integration and
demo hardening slice closed that wave.

This wave is self-gated before each merge and logged in `docs/DEVELOPMENT_WAVE_LOG.md`. Its
governing rule is **realistic experience, honest provenance**: the project is real — *Actualización de Estudios Socioambientales con
lineamientos BID … Puente del Amor – Los Hachos, cantón Yantzaza, provincia de Zamora Chinchipe*,
PROVIAL 2 EC-L1289 — and reconstructed operational data must never be silently converted into
historical fact. Wave A read the consultancy's delivery outside the repository and produced
`docs/REAL_DATA_INTAKE.md`; Wave B imported the cartography with the personal attributes removed
(ADR-023); Wave C imported the management plan chapter (ADR-024). The raw archive and workbook are
never committed, never uploaded and never sent to a model.
Staging is live for preview only; **do not deploy production** and never touch the `production`
branch.

Slice 4 is the first slice where a language model is part of the product, and its governing rule is
**rules calculate, AI proposes, a human validates, and the system preserves all three** (ADR-019).
It adds deterministic closed-question tabulation with declared denominators, a versioned and
immutable coding taxonomy (`taxonomy`, `taxonomy_version`, `taxonomy_category`), classification runs
and AI proposals (`classification_run`, `ai_classification`), specialist review as the validated
result (`human_review`), and the Social Intelligence surface. A published `TaxonomyVersion` is
immutable by database trigger; a submitted `HumanReview` is final; a correction never overwrites the
proposal it corrects. **Only `DEMO_SIMULATION` answers may be sent to a model**: the gate is checked
in the use-case and again in the worker, and a non-demo answer is refused with
`ai_processing_not_authorized` whatever the caller's role (SECURITY.md §10c). **Which classifier
runs is explicit configuration with no default** (IG4-001, SECURITY.md §10c.1): the deterministic
fake is permitted only in `local` and `test`, an unset `SOCIAL_CLASSIFIER` means assisted coding is
unavailable rather than faked, a gateway without its credential is `BLOCKED_EXTERNAL_CONFIG`, no run
is written when nothing can process it, and a worker with no usable classifier never claims.
The model's confidence is an uncalibrated heuristic and AI-vs-human coincidence is **agreement,
never accuracy**; `HumanReview` is not a thesis gold standard (TD-044). Social analytics require
`field.responses.read` even for aggregates, because RLS would otherwise return silent zeros
(TD-045).

**Slice 5 (Quality Gate)** turns known document inconsistencies into a traceable specialist review.
Five deterministic rules compare two sources and say they disagree; none says which is right and
none declares compliance (invariant 11, enforced by a vocabulary test over the catalogue, over every
generated finding and over what is stored). The rule catalogue is **versioned code, not a table**
(ADR-020, amending ADR-008 §1); a finding stores `requirement_key` + `requirement_version` as text.
`specialist_review` is append-only — `REVOKE UPDATE, DELETE` *and* triggers — with a mandatory
justification; a change of mind is a second row. A re-run reconciles on a fingerprint, so a decided
finding stays decided and only changed evidence reopens it. Evidence is a `document_assertion` read
by hand from the corpus with **no page number**, because document ingestion does not exist yet and a
citation nobody can check is a fabrication. Checking (`quality.write`) and deciding
(`quality.review`) are different grants: a specialist runs, a reviewer settles.

**Slice 6 (document intelligence)** adds the evidence layer and a scoped assistant. `SourceDocument`
→ immutable `DocumentVersion` → immutable `DocumentChunk`; a citation names a **version**, and a
corrected file is a new version whose predecessor keeps its words (`document_chunk` refuses UPDATE
and DELETE by grant *and* trigger). **Retrieval is PostgreSQL full-text and says so on screen**
(ADR-021, amending ARCHITECTURE §5/§9 and AI_GOVERNANCE §8): there is no pgvector, no `vec` schema,
no embedding column and no fake embedder, because a stand-in vector is indistinguishable from a real
one. The citations are the answer — retrieval needs no model, only the narrative paragraph does, and
a generated answer may cite **only** what was retrieved (an invented index fails the answer rather
than being dropped). Nothing generated is persisted. A document flagged `contains_pii` is refused,
not redacted. The Quality Gate's evidence gained a passage link resolved at read time, so no Slice 5
finding was rewritten. `core.documents` and `quality.rag_assistant` are now AVAILABLE.

**Slice 7 (assisted report generation)** produces the social chapter, and its governing rule is
**the snapshot is the deliverable and the prose is a rendering of it** (ADR-022). A
`ReportVersion` stores a validated JSON snapshot in which **every fact carries a typed source** —
`metric` with its method in words, `human_review` (a validated coding, never a proposal),
`quality_finding` with the decision a reviewer took, `document_chunk` with its version and page, or
`provenance` with its facets. A fact without a source is unrepresentable. The snapshot is computed
and checked **before** any prose exists, prose is generated from the snapshot and never from the
database, and a paragraph stating a figure its section did not compute **fails the generation**
rather than being trimmed. A version, its sections and its sources are written once (REVOKE *and*
trigger); regenerating produces a new version and never edits the old one. A theme figure resting on
zero validated codings is refused; every regime a fact carries must be declared at the top. The
.docx says "BORRADOR — NO ES UN ENTREGABLE APROBADO" because there is no approval workflow (TD-060)
and nothing in the system can say otherwise. `reports.social_generator` is now AVAILABLE — the last
one, so the rail has no ANNOUNCED placeholder left.

**Wave C (the management plan)** reads the study's PGAS chapter and shows what the plan
**proposes**, in the document's own words (ADR-024). Three tables — `pgas_import_run` →
`pgas_plan` → `pgas_measure` — because the document has three levels; a *programme* is a banner row
with a title and nothing else, so it is two columns on the measure rather than an entity the source
does not contain. The delivered spelling survives the import (`FRENCUENCIA`, `RESPONSAB LE`, six
columns named more than one way, a plan with no code, a `N°` that repeats and skips), because those
are findings to report and not defects to repair. This product mints `measure_code` because the
document has no stable reference, and the surface says whose identifier it is. An import is a
version, idempotent by the file's SHA-256, and a revision supersedes rather than overwrites.
**Nothing records execution**: no compliance state, no evidence, no obligation — the road has not
been built, and `audit.environmental` keeps that lifecycle (ADR-024 §7). `compliance.pma` is
therefore AVAILABLE with a narrowed meaning, and the catalogue still holds exactly 14 keys.

**Wave D (the product's language)** made every word on screen Spanish (ADR-025). The rule is a
boundary rather than a translation pass: **a stored value is never rendered; a label for it is.**
The rail reads *Centro de control · Cartografía y predios · Trabajo de campo · Análisis social ·
Control de calidad · Documentos · Plan de Manejo · Informes*; the provenance drawer is headed
*ORIGEN DEL DATO* with a *Validación humana* field; the four SOURCE TYPE badges say *Dato histórico
· Dato calculado · Agregado sin datos personales · Simulación operativa* — the four categories and
their derivation are unchanged (invariant 13), only the words. The solid **DEMO** stamp is gone:
marking a simulation is an obligation (invariant 4), and a badge nobody reads twice has stopped
marking anything. Keys, capability names, URL segments, enum values and the database keep their
English names, and the consultancy's own words are quoted verbatim. `e2e/vocabulary.spec.ts` fails
on any `SCREAMING_SNAKE_CASE` or leaked English that reaches a screen; the vocabulary itself is
`docs/PRODUCT_LANGUAGE_ES.md`, and the divergence from the approved bundle is entry 15 of
`docs/DESIGN_BUNDLE_KNOWN_ISSUES.md`.

**The demo-readiness wave (5 Sep 2026)** finished the consultant-facing pass: the rail is ordered
the way the work happens and the Quality Gate is *Control de consistencia*; the management plan
reads as a plan rather than as a table; the study's four areas of influence are drawn from a
generalised outline while the stored geometry is untouched (TD-070); a plan's *lugar de aplicación*
is checked against that cartography (`rule.pgas_place_vs_influence_area@1`, TD-072); the shell stopped
loading a whole portfolio to draw a breadcrumb and the connection pool no longer runs on defaults
(TD-067). What to show a consultancy, and what to answer, is `docs/CONSULTANCY_DEMO_SCRIPT.md`; the
two products deliberately **not** started are described in `docs/CLIENT_PORTAL_DECISION.md` and
`docs/ENVIRONMENTAL_AUDIT_PRODUCT_DIRECTION.md`.

**The published client view (7 Sep 2026)** answers the question a consulting firm's customer
actually has, without giving them the workspace (ADR-027). The rule is that the portal is a
**publication, not a mirror**: `portal.client_publication` is an immutable, versioned, allowlisted
snapshot somebody with `portal.publish` decided the client may see, and the client's page reads that
row and issues no statement against a survey answer, an assignment, a validated coding, a finding, a
document or a parcel. The payload is *composed* from a closed vocabulary rather than filtered from a
record, so there is nowhere in it to put a respondent, an owner, a parcel code, a technician, a model
proposal or a confidence score. `DEMO_SIMULATION` is refused outright — the demonstration field
campaign never becomes client progress — and the affected-parcel count is withheld by name because
the corpus says 70 in one place and 71 in another and that review is open. `portal.preview` is new
beside `portal.publish`: a reviewer checks, a coordinator decides. **External client access is not
built**: no `ClientPortalGrant`, no portal session, and `eia_portal` is still granted nothing; the
standalone `/portal/:tenant/:project` requires an internal session and says so above the content
(TD-005, TD-077, TD-078).

**Production V1 Wave 1 — EIA Field (16 Sep 2026)** is the first EIA Studio client that is not a
browser: a React Native + Expo application for **offline field capture** (ADR-028), built because
eight production road projects have technicians working where there is no mobile data. Its governing
rule is **the same command, sent any number of times, produces one result and one set of rows**. The
device sends four *domain commands* — `visit.start`, `survey.upsert_draft`, `survey.submit`,
`visit.finish` — never rows, and the server executes them through **the use-cases the web form
calls**, so a phone cannot write a row a browser could not. `commandId` is generated once at the
moment of intent and never regenerated; `app.field_sync_receipt` remembers what it produced and
replays it on a retry. Five outcomes, and `superseded` is the one that matters: an obsolete intent
settles rather than retrying for ever. **A conflict never deletes local work** — an assignment
reassigned, cancelled, or a questionnaire that moved marks the row *requiere revisión* and keeps
every answer. Offline access is a window the server stamps, `min(session expiry, now + 7 days)`, and
a disconnected device **cannot** learn that an account was revoked — recorded, not mitigated. The
local database is SQLCipher keyed from SecureStore, and the application refuses to open an
unencrypted one. `EIA_FIELD_MOBILE` is the first capture channel with `supportsOffline: true`, so
`field.surveys.offline_mode = required` is now a policy a project can set; the catalogue still holds
exactly 14 keys, and offline remains configuration (ADR-018). **Not built and not pretended**: media
capture (TD-037), background sync, a correction workflow, any model call. The earlier plan to adapt
ODK/Kobo is superseded and kept as history in `docs/FIELD_CAPTURE_ADAPTER_CONTRACT.md`. What still
stands between this and eight production projects is in `docs/PRODUCTION_V1_GO_LIVE.md`.

**Production V1 Wave 2 — the product is bilingual (16 Sep 2026)** adds English beside Spanish, on
the web and on the phone, from one message catalogue (ADR-029, amending ADR-025). ADR-025's rule is
unchanged — *a stored value is never rendered; a label for it is* — but the words moved out of
`@eia/domain` and into `@eia/i18n`: the domain keeps the enum, the **glyph** beside a status, the
derivation of the four SOURCE TYPE badges, `allowsOnlineOnlyChannel`, `lowThreshold` and the quality
rules; the catalogue keeps everything a reader sees. `@eia/ui` holds no copy and no formatter. A
surface resolves the locale once and passes `{ locale, t, fmt }` down, so no component decides for
itself how a figure reads. An **abscissa** stays `2+840` in both languages, because it is surveying
notation and not a number. A **bilingual questionnaire is one `SurveyVersion`**: translations are
rows keyed by question and option id, frozen by the same trigger as the definition, and answers
still point at codes — one definition hash, one denominator, one response. **Invariant 11 and
invariant 10 now hold in both languages**, asserted over every message in both catalogues. What is
**not** translated is project source data: delivered documents, the management plan's own spellings,
a taxonomy's categories, a generated finding's stored text (TD-086), a report version, and the
client publication, which is rendered in the language it was published in (TD-085). The reader's
choice is a cookie, and the default is `es-EC`: a consultant whose browser is configured in English
did not ask for an English product. `docs/I18N_ARCHITECTURE.md` is the map.

**Production V1 Wave 2 (17 September 2026)** made the product one that eight studies can be loaded
into rather than one a developer seeds. Five merged changes, five ADRs.

**The product is bilingual** (ADR-029, above). **A project is prepared rather than scripted**
(ADR-030): *Preparar proyecto* is eight stages over the project as it is — no workflow engine, no
stored wizard position — with `PROJECT_DATA_MANAGER` (*Gestor de información*), a role that loads a
project's files and deliberately holds no `field.responses.read`, `pii.read`, `quality.review`,
`social.coding.review`, `portal.publish` or `project.configure`. Readiness is a **pure function of
one snapshot** and says only *EIA Studio can operate this project* — never that the study is complete
and never that it complies.

**A delivered file is stored** (ADR-031). Object storage sits behind one port; a key is
`t/{tenantId}/p/{projectId}/{namespace}/{objectId}` and carries **no filename**, because a bucket
listing is the one place RLS does not reach and a delivered file can be named after a person. The
client never proposes a key. An upload is verified against the **provider** — object present, size
within the signed ceiling, first bytes matching the declared format — and the SHA-256 is computed
from the bytes read back; `ETag` is recorded as the provider's entity tag and never treated as a
hash. `resolveStorageAvailability` never falls back: unset is unavailable, `memory` is refused
outside `local` and `test`, and no process refuses to boot over it. A corrected delivery is **v2**
and v1's words stay; the same bytes twice are answered rather than duplicated. **There is no bucket
in staging or production** — that is an owner action (TD-090).

**A photograph is evidence of a visit** (ADR-032), and the local file is the last thing to go:
released only when the server acknowledges the row, never when the PUT returns 200. Four kinds, and
the two that are missing are the design — no `document` and no `signature`, and the camera rather
than the photo library. Field media never automatically reaches the client portal, an AI provider,
the document corpus or a public map, and each is prevented by a type or a query rather than a rule.

**A file is read** (ADR-033), in the worker, with the queue in the table. **A locator is not always
a page**: a PDF's pages are printed and checkable, a DOCX's are computed by whatever renders it, so a
DOCX chunk carries the document's own heading trail and a database CHECK refuses a row whose locator
disagrees with itself. A scanned PDF is `REQUIRES_OCR` and **writes no chunk**, so it can never be
cited; OCR itself is not built (TD-098). Nothing is executed: pdf.js without eval or network fonts,
and a DOCX archive bounded against every entry's declared size before anything is expanded.

**Nothing in Wave 2 calls a model.** Retrieval is still PostgreSQL full-text and still says so on
screen.

**Production V1 Wave 3 (17 September 2026)** let a model read the layer Wave 2 built, and asked one
question four times: *how does a reader tell what this product calculated from what a machine
suggested?* Four merged changes, three ADRs.

**A download is a navigation** (ADR-034): *Descargar original* is a route that answers 303 to a
five-minute presigned GET and **404 to everything else**, auditing every issuance without the
filename, the hash or the key. And the upload → storage → **separate worker process** → chunk →
citation path is now one end-to-end test against real MinIO, closing TD-093 and TD-100.

**An AI candidate is not a finding** (ADR-035). A `quality_finding` carries a `requirement_key`
naming a deterministic rule; a model's suggestion has none, so writing one there would attribute a
finding to a rule that never ran. Four tables of its own, `IA-001` rather than `QG-001`, its own
page, and *Candidato generado por IA* — never *error detectado*. Retrieval-first over seven bounded
lenses: **no passage → no model call**, **no citation → no candidate** (refused *and counted*, never
dropped), and invariant 11's forbidden vocabulary over every field. **The privacy gate refuses, it
never filters**: a corpus with one `REVIEW_REQUIRED` version stops the whole run and names the
document, and the refusal is audited in its own transaction. A candidate resting on one passage can
be dismissed and **cannot be accepted**. The model's words are write-once; every decision, including
a dismissal, is append-only with a mandatory justification.

**A template prints only what this product is willing to say** (ADR-036). A consultancy's own
`.docx`, versioned, validated and activated. A **closed placeholder vocabulary** rather than object
traversal, so what is absent from it — personal data, an AI proposal, a storage key — is checkable
rather than intended; a tag nobody declared **blocks activation**. **Absence is not zero**: a
corridor nobody measured prints *Dato no disponible*, and a placeholder a document cannot be honest
without stops the document. Every output carries **BORRADOR — NO ES UN ENTREGABLE APROBADO**,
required in the template and verified in the rendered text. ES and EN version independently and are
never machine translated. `easy-template-x` was adopted after an audit that rejected
`docx-templates` for evaluating JavaScript from the template; `@xmldom/xmldom` is overridden to an
advisory-clean patch.

**Study #2 exists because somebody made it in the product** — *Nuevo proyecto* on the Portfolio,
then *Preparar proyecto* — and a registry test fails the moment a project-scoped table forgets the
project. Migrations 0034…0047 are applied to **staging**, where `pnpm test:staging` passes 99
assertions.

**No live model is enabled anywhere**: `SOCIAL_CLASSIFIER`, `ASSISTANT_GENERATOR` and
`DOCUMENT_REVIEWER` are unset in every environment this repository controls. What stands between
this and eight production projects is in `docs/PRODUCTION_V1_GO_LIVE.md` and
`docs/PRODUCTION_RECOVERY.md`; the remaining blockers are decisions rather than engineering.

**Go-Live Wave A — PR A (17 September 2026)** closes go-live blocker 8: **a questionnaire is written
inside the product, and a published one is never edited** (ADR-037). *Preparar proyecto* →
*Formularios* is where a `SurveyVersion` now comes from, behind two permissions rather than one —
`field.instruments.author` writes a `DRAFT`, `field.instruments.publish` decides households may be
asked it, and a *Gestor de información* holds the first and not the second. What is **not** built is
the decision: no conditional logic, no expression syntax, no calculated question, no matrix, no
repeating group, no new question type — each is a language four independent renderers would have to
agree about exactly, and the surface writes only the questionnaire this product already asks,
answers offline, synchronises and counts. A **section** is a heading, not an entity: moving a
question between headings changes no code, no option, no denominator and not even the definition
hash. A second language is complete or absent, checked at publication. Editing a published version
is offered nowhere; a correction is the next version, copied, and the answers already given keep the
questionnaire they were asked (ADR-006). `FIELD_SYNC_PROTOCOL_VERSION` is **2**, because the Field
Pack's question gained `section` and the pack's schemas are `.strict()`. The map is
`docs/SURVEY_AUTHORING.md`; the proof seeds nothing.

**Go-Live Wave A — PR B (18 September 2026)** closes go-live blocker 6: **a correction is a new
response, and one resolver says which one counts** (ADR-038). A submitted response is still never
edited; correcting one is a **new capture on a revisit assignment**, in the same campaign, on the
same parcel, against the same questionnaire, with `survey_correction` recording which response it
replaces, why and who asked. History keeps both; current analytics count exactly one. **One place
answers "which response does this study mean?"** — the view `app.effective_survey_instance`,
`security_invoker = true`, joined by social tabulation, the numeric summary, validated themes, field
progress and the report snapshot alike; a test walks `packages/application/src` and fails if a
second implementation appears. Three states — REQUESTED → APPLIED | CANCELLED — and the absent ones
are the decision: submitting **is** applying, in the same transaction, and **a requested correction
changes no count**. A lineage is a line by constraint: two partial unique indexes, three CHECKs and
a cycle-walking trigger. Requesting is `field.corrections.request` (COORDINATOR, SOCIAL_SPECIALIST);
a technician receives a **revisit** and is told the reason and **no previous answer**.
`FIELD_SYNC_PROTOCOL_VERSION` is **3**. Campaign progress counts parcels rather than captures. A
report version already generated is unchanged; the next one uses the correction. The map is
`docs/SURVEY_CORRECTIONS.md`.

**The Go-Live readiness wave (18 September 2026)** built no product. It turned what was known into
what a person can act on: `docs/PRODUCTION_PRIVACY_CHECKLIST.md` (thirteen data classes, twelve
questions each, with every legal answer left as **OWNER / LEGAL REVIEW REQUIRED** and a sign-off
appendix that is deliberately **not** a database boolean), `docs/PRODUCTION_INFRASTRUCTURE_DECISION.md`
(the one hard blocker being that Railway can serve PostGIS **or** point-in-time recovery, never
both), `docs/CONSULTANCY_TEMPLATE_REQUEST.md`, `docs/EIGHT_ROAD_ONBOARDING.md` — which holds
**zero fake projects**, because eight rows in a table would prove nothing — and
`docs/OWNER_GO_LIVE_ACTIONS.md`. Two operator tools: **`pnpm go-live:doctor`**, kept separate from
`ops:doctor` because *is this stuck?* and *can we go live?* fail for different reasons, and
**`pnpm restore:drill`**, which was **run and passed** on synthetic local data — 52 of 52 migrations,
71 tables all FORCE RLS, 142 policies, the effective-response view back with `security_invoker` —
while claiming nothing about a provider restore nobody can perform yet. Storage is still
`NOT_CONFIGURED` everywhere, no mobile build exists on any machine, the staging MapTiler key is a **Free**
key and Free permits no commercial use, and every remaining gate ends at an owner action rather
than at code.

## Read before acting

Approved design bundle (source of truth; precedence: README → prototype → spec v0.2 → screenshots):

- `design/reference/claude-design-v0.2/README.md` — contract and 14 invariants
- `design/reference/claude-design-v0.2/EIA Studio.dc.html` — interactive prototype (behaviour)
- `design/reference/claude-design-v0.2/Arquitectura y Lenguaje Visual.dc.html` — spec v0.2 (rules)
- `design/reference/claude-design-v0.2/screenshots/` — golden visual references (not pixel specs)

Architecture documentation:

@docs/PRODUCT.md
@docs/ARCHITECTURE.md
@docs/TENANCY.md
@docs/FEATURES.md
@docs/SECURITY.md

Also relevant by task: `docs/DATA_MODEL.md`, `docs/PROVENANCE.md`, `docs/AI_GOVERNANCE.md`,
`docs/DEMO_ZAMORA.md`, `docs/DESIGN_SYSTEM.md`, `docs/TESTING_STRATEGY.md`,
`docs/GIS_IMPORT_CONTRACT.md`, `docs/FIELD_CAPTURE_ADAPTER_CONTRACT.md`, `docs/PGAS_MODEL.md`,
`docs/PRODUCT_LANGUAGE_ES.md`, `docs/I18N_ARCHITECTURE.md`, `docs/ZAMORA_WORKSPACE.md`,
`docs/PRODUCT_VALUE_AND_DIRECTION.md`, `docs/CONSULTANCY_DEMO_SCRIPT.md`,
`docs/CLIENT_PORTAL_DECISION.md`, `docs/ENVIRONMENTAL_AUDIT_PRODUCT_DIRECTION.md`,
`docs/REAL_DATA_INTAKE.md`, `docs/FIELD_MOBILE_ARCHITECTURE.md`,
`docs/PROJECT_INTAKE.md`, `docs/OBJECT_STORAGE.md`,
`docs/DOCUMENT_UPLOAD_AND_VERSIONING.md`, `docs/FIELD_MEDIA.md`,
`docs/DOCUMENT_EXTRACTION.md`, `docs/AI_DOCUMENT_REVIEW.md`, `docs/REPORT_TEMPLATES.md`,
`docs/OFFLINE_SYNC_PROTOCOL.md`, `docs/FIELD_MOBILE_OFFLINE_UAT.md`,
`docs/SURVEY_AUTHORING.md`, `docs/SURVEY_CORRECTIONS.md`,
`docs/PRODUCTION_V1_GO_LIVE.md`, `docs/PRODUCTION_RECOVERY.md`,
`docs/PRODUCTION_PRIVACY_CHECKLIST.md`, `docs/PRODUCTION_INFRASTRUCTURE_DECISION.md`,
`docs/OWNER_GO_LIVE_ACTIONS.md`, `docs/EIGHT_ROAD_ONBOARDING.md`,
`docs/CONSULTANCY_TEMPLATE_REQUEST.md`,
`docs/DATA_CLASSIFICATION_MATRIX.md`, `docs/GENERALISATION_AUDIT.md`, `docs/FIELD_MOBILE_BUILDS.md`,
`docs/STAGING_OPERATIONS.md`,
`docs/IMPLEMENTATION_PLAN.md`, `docs/DESIGN_BUNDLE_KNOWN_ISSUES.md`, the delivery docs
`docs/ENGINEERING_STANDARDS.md`, `docs/RELEASE_POLICY.md`, `docs/CI.md`, `docs/DEPLOYMENT.md`,
`docs/DEPENDENCIES.md`, `docs/TECH_DEBT.md`, the Gate record `docs/DECISIONS/GATE-1.md`, and
the ADRs in `docs/DECISIONS/ADR-001` … `ADR-038`. Root `README.md` has the local quick start.

## Working rules for every session

1. **Read the relevant docs and ADRs before any architectural change.** If a change contradicts
   an ADR, write or amend an ADR first (status Proposed) and say so in the summary.
2. **Inspect existing code before making claims or changes.** Do not describe files, functions
   or behaviour you have not opened in this session.
3. **Never hardcode Zamora.** The pilot project name, province, customer, consultant names, the
   figures 7.4 / 141 / 119 / 185, and "road" as the universal project type belong in
   `fixtures/` and project datasets, never in `packages/domain`, `apps/*` or `packages/ui`.
4. **Always preserve tenant and project context.** Use-cases take a `RequestContext` or
   `JobContext`; identifiers in payloads are validated against the context, never trusted.
   Every new table carries `tenant_id` (and `project_id` when project-scoped), RLS policies and
   the composite FK; register it in the RLS registry.
5. **Use centralised capability resolution.** Read the boolean `CapabilitySet` from the
   context; never add ad-hoc booleans. Navigation presentation (ACTIVE / ANNOUNCED / HIDDEN) is
   shell-only and never authorizes anything; an ANNOUNCED module is disabled. The catalogue holds
   exactly the 14 approved keys. Configuration ≠ capability.
6. **Enforce authorization server-side.** Every server action, route handler and job calls
   `requireCapability` and `requirePermission`. Hiding a nav item is not authorization.
   Authorization comes from EIA Studio memberships, roles and permissions, never from the
   identity provider's organisation roles (Better Auth supplies `userId` only).
7. **Preserve provenance.** Anything shown as a figure, layer, record, classification, finding
   or report section has a `provenance_id` whose record carries the four facets: regime, origin,
   transformations, granularity. The four v0.2 SOURCE TYPE badges are derived labels, not stored
   values. Derived values are produced by runs with method text and input edges. Synthetic data
   is never re-labelled.
8. **Never send identified PII to an LLM without the approved deidentification path.** `ai`
   ports accept only `Deidentified<T>` produced by the gateway; do not add bypasses "for a demo".
9. **Preserve original survey answers.** Answers are immutable after submission; corrections are
   new visits/instances. Never edit an answer, not even spelling.
10. **Keep AI classification separate from human review.** `ai_classification` is insert-only;
    `human_review` is append-only; analytics read only validated codings; scores are model scores
    with High/Medium/Low labels, never probabilities.
11. **Write tests** with every change: unit/domain for logic, integration for DB/RLS, and add new
    entry points to the cross-tenant attack harness and enforcement registry.
12. **Run lint, typecheck and tests before declaring work complete**, and report the actual
    output. If something failed or was skipped, say so.
13. **Document intentional technical debt** in `docs/TECH_DEBT.md` with owner and removal
    trigger; do not leave it only in code comments.
14. **Create or update an ADR when changing an architectural decision**
    (`docs/DECISIONS/ADR-NNN-slug.md`, same template as the existing ones).
15. **Never weaken isolation or security to simplify a demo.** No RLS bypass roles in app
    config, no "temporary" cross-tenant queries, no PII in fixtures, no synthetic values without
    regime, no portal reads of operational tables, no forecast in the portal unless explicitly
    published under `client.portal.show_forecast`, no real personal data before the compliance
    gate (`docs/SECURITY.md` §10a). Do not write legal conclusions into code or docs.

## Delivery rules (Git, releases, CI, deployment) — see `docs/ENGINEERING_STANDARDS.md`

16. **Work on a feature branch**, never directly on `main`: `feat/*`, `fix/*`, `chore/*`,
    `docs/*`, `refactor/*`, `test/*`. Changes reach `main` only through a pull request that is
    squash-merged. Commit or push only when the user asks.
17. **Use Conventional Commits** for commit messages and PR titles (`type(scope): subject`,
    scopes listed in `docs/ENGINEERING_STANDARDS.md` §3). Add the `Tenancy-impact:` and
    `Schema-impact:` footers when relevant.
18. **Add a Changeset** (`pnpm changeset`) when a change is release-visible (behaviour, UI,
    entry points, schema, configuration keys, catalogue, fixtures). Docs-only, ADR, CI/tooling,
    test-only and invisible refactors need none; say so in the PR.
19. **Never bypass CI or branch protection.** Do not use `--no-verify` to get a failing check
    through, do not force-push to `main`, do not disable required checks. Fix or revert.
20. **Never deploy production** without an explicit user instruction in the conversation.
    Staging deploys from `main` automatically once enabled; production is manual and gated
    (`docs/DEPLOYMENT.md` §6). Never store secret values in the repository; names only.
21. **Document schema/migration effects** of every change: migration ids, RLS policy changes,
    backfills and rollback notes, in the PR description and, when durable, in the ADR or
    `docs/TECH_DEBT.md`.
22. **Report tenancy and security impacts in every PR summary**: new entry points and their
    capability/permission checks, new tables' tenancy columns/RLS/composite FK, harness
    coverage, PII/audit/portal effects. "None" must be stated explicitly, never implied.
23. **Keep the stack minimal**: no Prisma beside Drizzle, no TanStack Router/Start, no Redis,
    event bus, Kubernetes, microservices or extra API service without an ADR that names the
    slice requirement (ADR-012, ADR-013, ADR-014).

## Product language rules (lint-enforced later)

- Model scores: allowed "model score 0,86 · confianza Alta"; forbidden "% de acierto",
  "precisión del", "probabilidad calibrada".
- Quality Gate: allowed "possible inconsistency", "missing information", "potential mismatch",
  "insufficient evidence", "specialist review required"; forbidden "incumplimiento",
  "infracción", "error detectado", "no conforme", "el sistema determina".
- Disabled modules never appear greyed-out or padlocked; direct links render the
  `feature disabled` state.
- Every map, including thumbnails, shows the state legend and the layer-provenance legend.

## Conventions (to apply once implementation is approved)

- TypeScript strict; pnpm workspace; modules under `packages/domain/<module>` with a public
  `index.ts`; no imports of a sibling module's internals (ESLint boundaries).
- UUID v7 ids; business identifiers are separate unique columns per project.
- Zod `strict()` schemas at every boundary; server actions are thin (validate → context →
  use-case).
- Spanish (`es-EC`) is the default locale; user-facing copy lives in message catalogues.
- Tokens and components from `packages/ui`; never inline hex values or screenshot pixel widths.
- Drizzle ORM only (schema in Drizzle, RLS/PostGIS/pgvector in reviewed SQL migrations,
  ADR-013); Next.js App Router with selective TanStack Table/Query/Virtual/Form per ADR-014.
- Husky + lint-staged (`pre-commit`), commitlint (`commit-msg`), light optional `pre-push`;
  the full suite runs in GitHub Actions (`docs/CI.md`).

## When the phase changes

Implementation begins only with slice 0 of `docs/IMPLEMENTATION_PLAN.md`, after the architect
gives an explicit go (to be appended to `docs/DECISIONS/GATE-1.md`). Update the "Current phase"
line above when that happens. Hosting is decided before staging; the compliance review is a
production readiness gate.
