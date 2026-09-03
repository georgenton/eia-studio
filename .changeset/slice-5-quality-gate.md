---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/ui": patch
"@eia/web": minor
---

Slice 5 — Quality Gate: known document inconsistencies become a traceable specialist decision.

**Rules detect; a person decides.** Five deterministic rules compare two sources and say they
disagree. None of them says which one is right, and none declares compliance — the vocabulary of
invariant 11 is data in the domain, asserted over the rule catalogue's copy, over every generated
finding, and over whatever is actually stored.

**The rule catalogue is versioned code, not a table** (ADR-020, amending ADR-008 §1). A rule version
is a definition *and* an implementation; a `definition jsonb` beside a TypeScript comparison gives
one rule two homes that nothing keeps in agreement, and making the column authoritative means
writing an interpreter for it. A finding stores `requirement_key` + `requirement_version` as text,
so it names the exact rule that produced it.

**A decision is permanent.** `specialist_review` is append-only — `REVOKE UPDATE, DELETE` from the
runtime role *and* triggers, so the owning role cannot either. Every decision needs a justification
of at least twelve characters, attributed and kept forever. A change of mind is a second row.

**A re-run never overrules a person.** Findings reconcile on a fingerprint that identifies the
comparison rather than its values, so a second run updates instead of duplicating and a decided
finding stays decided. Only *changed evidence* reopens one, with the decision history intact.

**No fabricated citation.** Document ingestion is a later slice, so evidence is a
`document_assertion`: a value read by hand from the study's corpus with the human-readable reference
it came from, and **no page number**. A CHECK refuses an assertion claiming to come from an ingested
document while none can exist, and the screen says what the evidence actually is.

**The vulnerability rule compares two documents, never a person.** A vulnerability indicator on a
household is special-category personal data; the demo questionnaire collects none, and the rule
contrasts the legal chapter's conclusion with the social chapter's own published figure instead.

Also: a `revisor@demo.invalid` synthetic identity, because settling a finding requires
`quality.review` and no existing demo role held it. No role's permissions changed.
