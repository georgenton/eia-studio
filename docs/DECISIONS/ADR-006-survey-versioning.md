# ADR-006 — Survey template versioning and answer immutability

- Status: Accepted at Gate 1 (no specific conditions raised; see GATE-1.md)
- Date: 2026-09-01
- Related: DATA_MODEL.md §3.4, ADR-007

## Context

Instruments change during a project: v1 of the socioeconomic sheet is used for forty surveys,
requirements change, v2 is used afterwards. Historical responses must keep referencing the
questionnaire they were answered against and must never be reinterpreted or mutated because the
questionnaire changed. The prototype shows instrument versions ("instrumento social v2",
`affectation_v3`), instrument states (NOT STARTED · IN PROGRESS · COMPLETE · NEEDS REVIEW ·
VALIDATED) and requirement rules per instrument (minimum photos, GPS).

## Decision

1. **`SurveyTemplate` and `SurveyVersion` are distinct.** A template is the stable identity
   ("socioeconomic sheet"); a version is an immutable, published questionnaire with its questions,
   options, PII flags and evidence requirements (min photos, GPS required), plus a schema hash.
2. **A `SurveyInstance` references exactly one `SurveyVersion`**, and each `Answer` references a
   `Question` of that version. Publishing a new version never touches existing instances.
3. **Versions are immutable once published**; edits produce a new draft version. Retiring a
   version prevents new instances but keeps history readable.
4. **Answers are immutable after submission** (domain rule + DB trigger). Corrections in the field
   are new visits/instances or annotated revisits, never edits of a submitted answer. Coding of
   open answers lives in the social layer (ADR-007), not on the answer.
5. **Cross-version aggregation requires an explicit `QuestionMapping`** (from question → to
   question, method, author) recorded with provenance; without it, metrics report per-version
   bases. No implicit matching by question key.
6. **Instrument state** is a property of the instance; only `validated` instances feed analytics,
   reports and the portal. `complete` means filled, not reviewed.
7. **PII questions** are flagged on the version; their answers are stored in the `pii` schema
   under the same instance, keeping the analytical answer table free of identifiers.

## Consequences

- Reporting across versions is explicit and auditable, at the cost of a mapping step when
  instruments change.
- The FieldFlow mobile app (later) must download the version in force for an assignment and
  submit instances bound to that version id; offline sync carries version ids, never labels.
- Template editing UI must make "publish new version" a deliberate action with a diff view
  (later slice).

## Alternatives rejected

- Mutable questionnaires with "last modified" timestamps: reinterpretation of history.
- Storing the full questionnaire JSON inside each instance: immutability by copy but no shared
  identity for analytics; versions give both.
