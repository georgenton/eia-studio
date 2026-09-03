# 07 · Quality Gate

`/t/…/p/…/quality`. The surface that turns known inconsistencies in a project's documents into a
traceable specialist decision.

## What it does, and what it refuses to do

It **compares two sources and says they disagree**. It does not say which one is right, and it never
declares compliance or non-compliance — that is invariant 11, and the vocabulary is enforced by a
lint and by tests over every finding the rules generate.

Every finding shows Source A and Source B at the same size, in the same treatment, quoted as they
are written. The layout is the argument.

## The rules that ship

Five, all deterministic. They are listed on the page whether or not they fired, because a gate that
shows only its findings is indistinguishable from one that never ran.

| Rule                                  | Compares                                                      | Severity                 |
| ------------------------------------- | ------------------------------------------------------------- | ------------------------ |
| `rule.affectation_count`              | the affected-parcel total stated in two documents of the file | alta                     |
| `rule.territorial_institution`        | an institution's jurisdiction against the project's own       | alta                     |
| `rule.consultation_planned_vs_actual` | the planned consultation date against the one recorded        | media                    |
| `rule.vulnerability_conclusion`       | a legal conclusion against the social chapter's own figure    | alta, interdisciplinaria |
| `rule.project_identity`               | an identifier in the file against the project record          | media                    |

A rule whose inputs are missing produces **no finding** — it is reported as skipped. "The document
does not say" and "we could not find where it says it" are different claims, and only the first is
about the study.

## Who does what

| Role                                  | Read findings | Run the check | Settle a finding |
| ------------------------------------- | ------------- | ------------- | ---------------- |
| Coordinator                           | ✅            | ✅            | —                |
| Social / environmental specialist     | ✅            | ✅            | —                |
| GIS specialist, viewer                | ✅            | —             | —                |
| **Reviewer** (`revisor@demo.invalid`) | ✅            | —             | ✅               |
| Field technician                      | —             | —             | —                |

A specialist checks; a **reviewer decides**. To exercise the decision half of the demo you must sign
out and sign in as the reviewer (page 01).

## The lifecycle

`OPEN` → `UNDER_REVIEW` → `ACCEPTED` → `RESOLVED`, with `DISMISSED` reachable from the first two and
`REOPEN` from the last three. Accepting says _the disagreement is real_; resolving says _and the
document has been corrected_. Every transition needs a justification of at least twelve characters,
and the transition the state machine forbids is not offered in the form and is refused by the server.

**A decision is permanent.** It is never edited or deleted — the database refuses both. A change of
mind is a second decision, and both stay on the page with their authors.

## Re-running

Safe and expected. A run reconciles on a fingerprint, so the same disagreement updates its existing
finding rather than raising a second one. A finding somebody already decided **stays decided** — a
scheduled check does not overrule a person. Only _changed evidence_ reopens it, and the decision
history survives the reopening.

## What the evidence is, today

Values read by hand out of the concluded study's corpus, each with the human-readable reference it
was read from. **No page numbers**: no document has been ingested yet (that is page 08), and a page
citation nobody could check would be a fabrication in the one field whose purpose is that a finding
can be verified. The screen says so under every quote.

The four findings on the demo project are real inconsistencies in the concluded study's file. The
fifth rule's inputs agree in this project, so it is listed and quiet.
