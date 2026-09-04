# ADR-022 — The report snapshot is the deliverable; the prose is a rendering of it

- Status: Accepted (Slice 7)
- Date: 2026-09-03
- Related: ADR-005 (faceted provenance), ADR-019 (three layers of truth), ADR-020 (evidence is data),
  ADR-021 (retrieval and the assistant), AI_GOVERNANCE.md §8, PRODUCT.md invariants 4, 8 and 10

## Context

A report is where every earlier slice's care either survives or evaporates. Tabulation declared its
denominators, a specialist settled what each open response meant, a reviewer decided what two
disagreeing documents imply, and a citation names a document version — and then a paragraph gets
written and all of it becomes *"se registran 70 predios afectados"*, a sentence with no way back to
any of it.

The obvious implementation makes that failure certain. Give a model the project's data, ask for a
social chapter, store the text: what is stored is the prose, the figures inside it are unverifiable
strings, and regenerating produces a *different* chapter from the same data with no way to say which
one the study used.

Three further constraints, all of which the obvious implementation breaks:

- validated figures come from `human_review` only; a provisional AI classification must never reach
  a report as a finding (ADR-019);
- a delivered report is never overwritten — a study's chapter three is a thing that was delivered on
  a date;
- no model is configured anywhere (TD-049), so a design in which prose is load-bearing produces
  nothing at all today.

## Decision

1. **The unit of generation is a `ReportVersion`, and its substance is a deterministic
   `snapshot`.** Generating a version computes every figure from validated data, records each one
   with the source it came from, and stores that structure. The snapshot is what is versioned, what
   is diffed, and what a later reader checks. It is produced by arithmetic and SQL, never by a
   model, and it is complete on its own — a version with no narrative is a usable report draft.

2. **Prose is a rendering of the snapshot, not a source of facts.** When a generator is configured
   it receives the snapshot — not the database, not the documents — and writes one paragraph per
   section from those numbers. Where none is configured, sections carry no narrative and the surface
   says why, exactly as the document assistant does (ADR-021 §4). The snapshot is identical either
   way, which is the property that makes the narrative optional rather than essential.

3. **Every fact in a snapshot carries a typed source.** `metric` (a deterministic computation, with
   its method in words), `human_review` (a validated coding), `quality_finding`, `document_chunk`,
   or `provenance` (a historical aggregate with its facets). A fact with no source cannot be
   constructed: the type has no shape for one. This is D4's traceability, held by the data rather
   than by inline citations a reader would have to tolerate mid-sentence.

4. **A version is immutable.** No edit, no re-render in place, no "regenerate this section". A
   changed input produces a **new** version with its own snapshot, and the previous one keeps
   exactly what it said. `report_version` and `report_section` refuse UPDATE and DELETE by grant and
   by trigger, like `document_chunk` and `specialist_review` before them.

5. **A provisional coding can never enter a report.** The snapshot's social section reads
   `human_review` and nothing else, and the generator sees only the snapshot — so there is no path,
   including a mistaken one, by which an AI proposal becomes a sentence in a chapter. Asserted
   directly: a project with proposals and no reviews produces a validated distribution of zero.

6. **The DOCX is a rendering too, and says it is a draft.** It is generated from the snapshot with a
   pure-TypeScript library, carries "BORRADOR" and the version label on every page, and lists its
   sources. It is not an approved deliverable and the document says so in its own words — approval
   is `deliverables.approve` and a workflow this slice does not build (TD-060).

## Consequences

- A report is checkable. Every figure resolves to a metric with a method, a validated coding, a
  decided finding, or a cited passage — and the surface shows that resolution beside the figure.
- Regeneration is honest: two versions of the same chapter differ because their *inputs* differed,
  and the snapshots say how.
- With no model configured the product still produces a complete, traceable, downloadable report
  draft. That is not a degraded mode; it is the deliverable with its prose pending.
- The cost is that the narrative cannot say anything the snapshot does not contain. A specialist who
  wants a sentence about something uncomputed has to add the computation — which is the intended
  direction of pressure.

## Alternatives rejected

- **Generate prose from the database and store the text.** The failure this ADR exists to prevent.
- **Store prose with inline citations after every clause.** Traceability by annotation, at the cost
  of a chapter no one would put in front of an authority; and nothing prevents a sentence between
  two citations from asserting something neither supports.
- **Let a specialist edit the generated text in place.** Then a report is neither generated nor
  written, its provenance is a mixture nobody can decompose, and the immutability that makes an old
  version meaningful is gone. Editing belongs in the word processor the DOCX opens in, after the
  system has said exactly what it can vouch for.
- **Defer the whole slice until a model is available.** The snapshot, the versioning, the
  traceability and the DOCX are all independent of prose, and they are the parts that make the
  chapter defensible.
