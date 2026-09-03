# Slice 5 — Quality Gate

> What was built on `feat/slice-5-quality-gate`, what was deliberately left out, and every place
> the implementation departs from the approved design. Companion to `docs/SLICE_1_REPORT.md` …
> `docs/SLICE_4_REPORT.md`.

## 1. The journey this slice delivers

A coordinator opens Quality Gate and sees the rules the product checks — whether or not any of them
found something. They press **Ejecutar revisión**. Four findings appear, each one a real
inconsistency in the concluded study's file: two documents stating different affected-parcel
totals, an institution from another province, a consultation date that moved, and a legal
conclusion the social chapter does not support.

They open one. Source A and Source B sit side by side, the same size, quoted as written, neither
marked as the error. Below: why the rule looked, and what a person might do about it. There is no
decision form — a coordinator checks; a **reviewer** decides.

The reviewer signs in, reads the two sources, and dismisses one finding with a reason. The reason
is kept, attributed and permanent. Later they change their mind: that is a second decision, and both
are on the page.

## 2. Rules detect, a person decides — and neither can quietly become the other

| Layer | Produced by | Stored in |
|---|---|---|
| The comparison | pure detector functions over two values | nothing — recomputed each run |
| The finding | one `QualityRun` reconciling on a fingerprint | `quality_finding` + `finding_evidence` |
| The decision | a reviewer, with a mandatory justification | `specialist_review`, append-only |

Four rules hold it rather than describe it:

- **a re-run never overrules a person.** A finding somebody dismissed stays dismissed. Only
  *changed evidence* reopens it, and the decision history survives the reopening;
- **a decision is never edited or deleted** — the grant refuses it and, if the grant were ever
  restored, the trigger refuses it too;
- **a finding always shows two sources**, checked at commit by a deferred constraint trigger;
- **no finding declares compliance.** The vocabulary of invariant 11 is data in the domain,
  asserted over the rule catalogue's copy, over every generated finding, and over whatever is
  actually stored on staging.

## 3. The rule catalogue is code (ADR-020)

ADR-008 modelled requirements as tables with a `definition jsonb`. Building it exposed the problem:
a rule version is a definition *and* an implementation, and putting the definition in a column while
the comparison lives in TypeScript gives one rule two homes that nothing keeps in agreement. Making
the column authoritative instead means writing an interpreter for it — the generic rule engine this
slice is explicitly told not to build.

So the catalogue is `packages/domain/src/quality/requirements.ts`, and a finding stores
`requirement_key` + `requirement_version` as text. Reproducibility is unchanged: a finding names the
exact rule that produced it, readable in the repository at the commit the run happened on. What is
lost is the ability to change a rule without a deployment, which is the intended trade — rules make
claims about a study.

`Requirement` and `RequirementVersion` are therefore no longer tables. `QualityRun`,
`QualityFinding`, `FindingEvidence` and `SpecialistReview` are unchanged in substance.

## 4. The five rules

| Key | Compares | Type | Severity |
|---|---|---|---|
| `rule.affectation_count@1` | the affected-parcel total in two documents of the file | numerical | alta |
| `rule.territorial_institution@1` | an institution's stated jurisdiction against the project's | geographical | alta |
| `rule.consultation_planned_vs_actual@1` | the planned consultation date against the recorded one | temporal | media |
| `rule.vulnerability_conclusion@1` | a legal conclusion against the social chapter's own figure | cross-document | alta, interdisciplinaria |
| `rule.project_identity@1` | an identifier in the file against the project record | cross-document | media |

Three of them are worth explaining, because each is a place the obvious implementation would have
been wrong.

**QG-001 compares corpus against corpus, not corpus against the layer.** The brief describes the
real inconsistency as *70 vs 71*, and both figures come from the study's documents. The pilot's
parcel layer is synthetic geometry generated for the demo, with all 141 parcels carrying an
affectation; comparing a real historical figure against it would have produced a number-shaped
finding about nothing. When a project has an imported cadastre, layer-versus-document becomes worth
writing, and it will be its own requirement with its own version.

**QG-004 compares two documents, never a person.** The brief describes social records containing
vulnerability examples against a legal conclusion of "no vulnerable groups". Implemented literally
that would need a vulnerability indicator on survey records — special-category personal data, which
the demo questionnaire is built to collect none of (SECURITY.md §10b). Adding a field so a rule
could count it would be exactly the "small exception for a demo" the compliance gate exists to
prevent. It therefore compares the legal chapter's conclusion against the **social chapter's own
reported figure**: both are aggregate statements the study published. It never says the conclusion
is false; it says two documents describing the same population differ, and it is the one rule
flagged interdisciplinary by default.

**QG-003 is traceability, not a fault.** Participatory processes are reprogrammed for legitimate
reasons. The finding says the dates differ and asks for the reason to be recorded, and the copy is
written so a reader cannot mistake it for an accusation.

**QG-005 exists and stays quiet.** Its inputs agree in this project. It is listed on the surface
anyway, because a gate showing only its findings is indistinguishable from one that never ran.

## 5. The evidence, and the citation we refuse to invent

Document ingestion is Slice 6. Until it exists, evidence is a `document_assertion`: one value read
by hand out of the study's corpus, carrying the human-readable reference it was read from, its
quote, and its own provenance (`HISTORICAL_OBSERVED` / `IMPORTED_DOCUMENT` / `RECONSTRUCTED`).

**No assertion carries a page number**, and a CHECK refuses `source_kind = 'DOCUMENT_VERSION'` while
no document version can exist. A page citation nobody could follow would be a fabrication in the one
field whose entire purpose is that a finding can be checked. The screen says so under every quote:
*"Extracto reconstruido del expediente. Sin número de página: todavía no hay ingesta documental."*

The `document_version` evidence locator is nevertheless declared now, so a Slice 5 finding can be
*enriched* with a real citation later rather than rewritten (ADR-020 §6).

## 6. A defect this slice found in its own security posture

The first version of migration 0019 granted `SELECT, INSERT` on `specialist_review` and stopped
there, on the assumption that a narrower grant is a narrower privilege. It is not: migration 0002
set `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE`, so **every new
table in `app` arrives with full DML for `eia_app`** and a narrower `GRANT` beside it changes
nothing. The append-only guarantee was silently absent; the RLS policies happened to make the
statements affect zero rows, so nothing failed loudly.

Caught by the isolation test, which asserted an error and got a successful no-op. Fixed with an
explicit `REVOKE UPDATE, DELETE, TRUNCATE`, and the staging suite now asserts the privilege bits
directly rather than inferring them from the migration's text.

## 7. What was built

| Layer | Files |
|---|---|
| Domain | `packages/domain/src/quality/{finding,evidence,requirements,detectors}.ts` |
| Database | migration `0018` (5 tables), `0019` (grants, RLS, CHECKs, append-only and two-source triggers) |
| Application | `packages/application/src/quality/{run,review,read-models}.ts`, `scripts/run-quality-check.ts` |
| Web | `app/t/[tenant]/p/[project]/quality/{page.tsx,[findingCode]/page.tsx}`, `components/quality/*`, `lib/quality-actions.ts` |
| Fixture | `fixtures/projects/…/manifest.json` → `quality.assertions` (8 reconstructed values) |
| Operator | `pnpm quality:run --email … --tenant … --project …` |

## 8. Verification

| Suite | Result |
|---|---|
| Unit and domain | **243 passed** (+28 from this slice) |
| Integration (Testcontainers, RLS) | **285 passed** (+42: 20 isolation, 22 application) |
| End to end (Playwright) | **118 passed** (+20: 8 coordinator journey, 5 reviewer, 3 axe, 3 screenshots, and the reviewer's sign-in setup) |
| Accessibility (axe) | 19 scans, no serious or critical violations (3 new Quality Gate states) |
| Staging (non-destructive) | **70 passed** (5 files, 16 of them the new Quality Gate checks); migrations 18 → 20; snapshot: 8 assertions and 1 provenance record added, **every pre-existing id identical**, field baseline unchanged (12 assignments · 4 submitted · 26 answers), no dangling references |
| Seeder idempotency | stable; assertions upserted, findings and decisions untouched |
| Lint, format, typecheck, build | clean |

**No AI is involved anywhere in this slice.** The rules are deterministic comparisons; the semantic
one compares two statements the corpus itself makes. Nothing here calls a model, and CI needs no
credential for it.

## 8a. One state lost its last route

The inert "module not implemented" state (system state 15) now has **no reachable URL**. Every
workspace surface whose capability can be effective is built; the rest are ANNOUNCED, therefore
never effective, therefore 404. The browser assertion that used `/quality` as its example was
removed rather than propped up by shipping a capability nobody implements. The policy is still
asserted where it is decided — a pure function over the surface registry — and Slice 6 gives it a
real route back when `core.documents` becomes AVAILABLE before the Documents surface exists.
Recorded as TD-055.

## 9. Deviations

- **The rule catalogue is code, not tables** — ADR-020, which amends ADR-008 §1. Recorded as an
  accepted decision rather than an undocumented departure.
- **QG-001 compares two documents** rather than a document against the parcel layer (§4).
- **QG-004 compares two documents** rather than a conclusion against survey records (§4). This is a
  privacy decision, not a convenience one.
- **The finding lifecycle keeps ADR-008's five states**, not the four the brief offered as
  equivalent: `ACCEPTED` ("the disagreement is real") and `RESOLVED` ("and the document has been
  corrected") are genuinely different, and collapsing them would lose the distinction between
  knowing and having fixed.
- **The demo fixture gains a sixth synthetic identity**, `revisor@demo.invalid`, because no existing
  role holds `quality.review`. No existing role's permissions were changed.
- **The run is synchronous**, not a background job. Five rules are four SQL reads and a handful of
  comparisons, and a run that finishes inside the request is one a specialist can actually use. The
  `quality_run` row already carries `status`, `started_at` and `finished_at` for the day a rule set
  reads documents.

## 10. Debt this slice records

TD-050 (a rule cannot be changed without a deployment — the intended trade, stated), TD-051 (the
project's jurisdiction is parsed from its location label), TD-052 (no assignee on a finding),
TD-053 (no scheduled runs), TD-054 (a finding cannot be linked to a parcel yet, so the Parcel
Workspace's Calidad tab stays inert), TD-055 (the "module not implemented" state has no reachable
route).
