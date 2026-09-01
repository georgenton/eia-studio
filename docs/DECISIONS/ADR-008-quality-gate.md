# ADR-008 — Quality Gate as requirements, runs, findings, evidence and specialist decisions

- Status: Accepted at Gate 1 (no specific conditions raised; see GATE-1.md)
- Date: 2026-09-01
- Related: DATA_MODEL.md §3.6, PROVENANCE.md, ADR-005

## Context

Invariant 11: the system flags potential findings; a specialist qualifies them with mandatory
justification; "Resolve" never means the system declares compliance. The detail view shows
Source A / Source B with document locators and literal quotes, "Why flagged" with a rule id and
detection date, a suggested action written as a human task, and a specialist decision block.
Types: numerical, geographical, temporal, document completeness, cross-document inconsistency,
missing evidence. States: OPEN · REVIEWING · ACCEPTED · DISMISSED · RESOLVED. Severity: high,
medium, low. Permitted and forbidden language is defined. Findings are produced by an executed
review ("Ejecutar revisión · última revisión 28 ago 09:40"). A finding may need interdisciplinary
review. Source B may be a dataset rather than a document.

## Decision

1. **Structure**: `Requirement` (rule identity, e.g. `rule.numeric_cross_doc`) →
   `RequirementVersion` (immutable definition: inputs, comparison, tolerance keys, copy templates)
   → `QualityRun` (an execution with scope, trigger, rule versions, timestamps) →
   `QualityFinding` (type, severity, state, copy, interdisciplinary flag, assignee, fingerprint)
   → `FindingEvidence` (many per finding; roles source_a / source_b / context; typed locator) →
   `SpecialistReview` (append-only decisions with mandatory justification).
2. **Evidence locators are typed values, not FKs to every table**: `document_version` (page,
   section, chunk), `dataset` (key, version, filter), `record` (entity kind + id + field),
   `layer` (dataset version, feature), `metric` (snapshot). Validated per kind; rendered by one
   evidence component; "Abrir documento en el visor" resolves the locator.
3. **Deduplication across runs** by fingerprint (rule version + normalised evidence identity):
   unchanged inputs do not create duplicates; changed inputs reopen a dismissed/resolved finding
   with a new run reference.
4. **State machine**: open → reviewing → accepted → resolved; open/reviewing → dismissed;
   dismissed/resolved → open (reopen). Every transition except run-created `open` requires a
   `SpecialistReview` with non-empty justification, reviewer and timestamp. `resolved` requires a
   reference to the corrected artefact (new document version or corrected record) when
   applicable.
5. **Language**: rule copy templates and stored finding text may use only the permitted
   vocabulary (possible inconsistency, missing information, potential mismatch, insufficient
   evidence, specialist review required); forbidden words (incumplimiento, infracción, error
   detectado, no conforme, el sistema determina) are lint-checked in templates and asserted in
   tests over generated findings.
6. **Rules are pluggable and profile-scoped**: the pilot rule set is declared in
   `road_eia_social`; parameters (tolerances, minimum severity) are project configuration;
   rules run in the worker as a `QualityRun` job with the job's tenant/project context.
7. **Provenance**: each finding carries a `RECONSTRUCTED` provenance record with
   `validation_status = requires_specialist` and input edges to the evidence sources; decisions
   update validation status and write audit entries.
8. **Interdisciplinary review** is a flag set by rules that contrast disciplines (legal vs social)
   and a decision option (`request_interdisciplinary`) that keeps the finding in `reviewing` with
   two assignees.

## Consequences

- The Quality Gate is a review workflow with evidence, not an alerts table; findings are
  reproducible from rule versions and locators.
- Adding a rule = one requirement version + a rule implementation + scenario tests; no schema
  change.
- Findings referencing objects that are later superseded (new document version) keep their
  evidence locators pointing to the old version, which is correct for audit; the reopen logic
  handles new versions.
- Parcel Workspace "Quality" tab and GIS "Inconsistencia" state read open findings by
  `parcel_id` or evidence locators referencing the parcel.

## Alternatives rejected

- Simple alerts table with a text and a status: no evidence, no rule versioning, no
  deduplication, no interdisciplinary handling.
- Foreign keys from findings to every evidence table: schema coupling across all modules.
- Automatic closure when inputs match again: the human decision must remain the record.
