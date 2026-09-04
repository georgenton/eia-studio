---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/contracts": minor
"@eia/web": minor
---

Slice 7 — assisted report generation: the social chapter, produced from validated data, where every
figure names where it came from.

**The snapshot is the deliverable; the prose is a rendering of it** (ADR-022). A `ReportVersion`
stores a validated JSON snapshot of five sections, and every fact in it carries a typed source —
`metric` with its method in words, `human_review` (a validated coding, never a proposal),
`quality_finding` with the decision a reviewer took, `document_chunk` with its version and page, or
`provenance` with its facets. A fact without a source is unrepresentable: the type has no shape for
one. A version generated with no provider configured is therefore a **complete** report draft, not a
degraded one.

**Compute first, write second.** The snapshot is built from the database and checked before any
prose exists; prose is generated *from the snapshot*, never from the database. A paragraph that
states a figure its section did not compute **fails the whole generation** rather than being trimmed
— the failure worth preventing is the plausible number in a sentence nobody checked because the ones
around it were right. The check is arithmetic, not semantic (TD-061).

**What the chapter refuses to count.** Themes read `human_review` only; a theme figure claiming a
count from zero validated codings is refused. Quality observations read findings a reviewer decided,
with the decision, and never state compliance. Every regime a fact carries must be declared at the
top of the chapter and on the first page of the .docx.

**A version is written once.** `report_version`, `report_section` and `report_section_source` refuse
UPDATE and DELETE by grant *and* trigger. Regenerating produces a new version; the previous one
keeps exactly what it said. `snapshot_digest` identifies content rather than the moment of
computation, so regenerating unchanged data is visibly a no-change.

**The .docx says BORRADOR** on its first page and in every footer, prints the source under every
figure, and lists the regimes of the data it rests on. There is no approval workflow (TD-060):
`deliverables.approve` exists as a permission and nothing consumes it, so nothing in the system can
say the document is approved.

`reports.social_generator` moves from ANNOUNCED to AVAILABLE — the last one, so the navigation rail
has no placeholder row left. The narrative generator follows the same no-default availability rule
as `SOCIAL_CLASSIFIER` and `ASSISTANT_GENERATOR`.
