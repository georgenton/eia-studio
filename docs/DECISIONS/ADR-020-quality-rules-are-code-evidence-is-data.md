# ADR-020 — Quality rules are versioned code; evidence is data

- Status: Accepted (Slice 5)
- Date: 2026-09-03
- Amends: ADR-008 §1 (the `Requirement` / `RequirementVersion` tables)
- Related: ADR-005 (faceted provenance), ADR-015 (domain purity), ADR-019 (three layers of truth),
  DATA_MODEL.md §3.6, SECURITY.md, FEATURES.md §5.1

## Context

ADR-008 modelled the Quality Gate as five persisted entities: `Requirement` (rule identity) →
`RequirementVersion` (an immutable **definition jsonb** of inputs, comparison and tolerance keys)
→ `QualityRun` → `QualityFinding` → `FindingEvidence` → `SpecialistReview`. It was the right shape
for a specification. Building it exposed two problems.

**A rule version would have two homes.** The definition would live in a `jsonb` column; the code
that reads that definition and actually compares two numbers would live in TypeScript. Nothing
would keep them honest with each other. A definition edited in the database without a matching
implementation is a rule that silently stops meaning what it says — and a finding is a claim about
a study, so a rule that quietly changed meaning is the worst failure this module can have.

**The alternative is the thing we were told not to build.** Making the `jsonb` definition
authoritative — inputs, comparison operator, tolerance, sources — means writing an interpreter for
it. That is a generic rule engine: a small language, its own versioning, its own debugger, and no
type checking. Slice 5's brief says explicitly *do not build a generic rule engine; implement only
the quality patterns the real case needs*.

At the same time the *other* half of ADR-008 held up completely. Findings, their typed evidence
locators, the state machine and append-only specialist decisions with mandatory justification are
exactly right, and nothing here changes them.

There is also a sequencing problem. The evidence for the pilot's real inconsistencies comes from a
corpus of study documents that **has not been ingested** — document versions, extracted text and
chunks are Slice 6. The findings are real; the machinery that would cite them at page level does
not exist yet. Inventing page numbers to fill the gap would be a fabrication in exactly the field
whose purpose is to be verifiable.

## Decision

1. **The rule catalogue is code, not a table.** `packages/domain/src/quality/requirements.ts`
   declares every requirement once, with its key, version label, finding type, default severity,
   applicability, copy templates and the identity of its detector. It is a registry in the same
   sense as the capability catalogue (ADR-002) and the configuration schema registry: typed,
   reviewed, versioned with the code that implements it, and impossible to change in one place
   without the other.

2. **A rule version is a string on the finding, not a foreign key.** `quality_finding` stores
   `requirement_key` and `requirement_version` as text. Reproducibility is unchanged: a finding
   names the exact rule version that produced it, and that version is readable in the repository at
   the commit the run happened on. What is lost is the ability to *edit* a rule without a
   deployment, which is precisely what we do not want.

3. **Parameters stay configuration.** Tolerances and thresholds are project configuration keys
   under `quality.document_gate` (FEATURES.md §4), read by the detector at run time and recorded on
   the run. A tenant tunes a rule; a tenant does not redefine one.

4. **Custom tenant rules are out of scope, and the door is left open the same way it is for roles.**
   If a firm ever needs its own rule, it arrives as a `quality_requirement` table whose rows
   reference a detector key from this registry — data selecting an implementation, never data
   *being* one. No schema written today prevents that.

5. **Evidence is data, and its Slice 5 substrate is the `document_assertion` table.** A rule
   compares values; the values have to exist somewhere the run can read. Until documents are
   ingested, an assertion is one extracted value from the study corpus — a count, a date, an
   institution name — carrying its human-readable source reference, an optional quote, and its own
   provenance record. Every demo assertion is `RECONSTRUCTED` from the corpus and says so on
   screen; **none carries a page number**, because the page-level locator is not something we can
   honestly produce before ingestion.

6. **Slice 6 enriches rather than rewrites.** When document versions and chunks exist, an assertion
   gains an optional `document_version_id` and `chunk_id`, and new evidence locators point at
   chunks. Findings already raised keep the evidence they were raised with; nothing is
   retro-labelled as having come from a document it was not read from.

## Consequences

- Adding a rule is one registry entry plus one detector function plus scenario tests. No migration,
  no `jsonb` schema, no interpreter.
- A rule cannot be changed without review, and cannot be changed in production without a deploy.
  That is the intended trade: rules make claims about a study.
- `docs/DATA_MODEL.md` §3.6 is updated: `Requirement` and `RequirementVersion` are no longer
  tables. `QualityRun`, `QualityFinding`, `FindingEvidence` and `SpecialistReview` are unchanged in
  substance, and `document_assertion` joins them.
- The evidence a specialist sees during the pilot is honestly labelled as reconstructed from the
  corpus rather than cited from an imported document, and the difference is visible on screen, not
  only in a document nobody opens.

## Alternatives rejected

- **Keep `RequirementVersion` with a `definition jsonb`.** Two sources of truth for one rule, and
  an interpreter to write. The specification's shape without its safety.
- **Keep the tables but treat the definition as documentation, with the code authoritative.** Then
  the table is a copy that can drift, and the first time it drifts somebody will believe it.
- **Wait for Slice 6 and build the Quality Gate on real document chunks.** The four known
  inconsistencies in the pilot corpus are the clearest demonstration this product has of what it is
  for; deferring the whole review workflow behind an ingestion pipeline would delay the workflow to
  get a better citation format for it.
- **Fabricate page numbers for the demo evidence.** Considered only long enough to name it: the
  module's entire purpose is that a finding can be checked.
