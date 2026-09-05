# The environmental audit: a different product, and why the seam matters

> **Product direction. Nothing here is built, and this note does not authorise building it.**
> Related: ADR-024 §7 (the study stage and the audit stage are different products),
> `docs/PGAS_MODEL.md`, `docs/FEATURES.md` (`audit.environmental`, an extension, hidden),
> invariant 11 (the product never declares compliance).

## 1. The distinction this note exists to protect

**What EIA Studio holds today is a plan that a study proposes.** Cap 11 of the Puente del Amor –
Los Hachos study: nine plans, twenty-two programmes, eighty-six measures, each with an indicator, a
means of verification, a responsible party, a frequency and a term. It is a *document*, imported as
written, and the product records nothing about whether any of it is being done — because the road
has not been built and nobody is doing it.

**An environmental audit is the opposite direction of travel.** It starts from obligations that are
already in force and asks, of each one, what actually happened: was the measure executed, when, by
whom, with what evidence, and does the evidence support the claim.

The two look similar on a screen — both are lists of measures — and that resemblance is the danger.
A product that put a *Cumplido / No cumplido* column on the current PGAS surface would be asserting
that a consultancy is auditing work that has not started. That is the same class of claim that
invariant 11 forbids and that ADR-022 was written to prevent in reports.

## 2. The chain, and where each link comes from

```
PgasMeasure                the study's proposal — a row of the chapter, stored as written
     │  an explicit human act: adoption. Somebody with authority says
     │  "this measure is now an obligation of this contract, in force from this date"
     ▼
ComplianceObligation       what must be done: the measure's text, frozen at adoption, plus a
     │                     period, a responsible party and the indicator it will be judged by
     ▼
Evidence                   what was submitted: a photograph, an invoice, a monitoring report, a
     │                     signed register — each a document version with its own provenance
     ▼
SiteInspection             what an inspector saw, on a date, at a place, with their own record
     │                     — an observation, never a conclusion
     ▼
AuditFinding               a specialist's judgement that the evidence does or does not support the
     │                     obligation, with a written justification, append-only
     ▼
AuditReport                a period's findings, as a deliverable, with every judgement sourced
```

**Adoption is the seam.** It is not an import and it is not a status change: it is a person, with a
permission, saying that a proposal has become an obligation. Everything upstream of it is a reading
of a document; everything downstream is a claim about the world. They share a lineage — an
obligation names the measure it came from — and they must not share a table.

## 3. What the audit stage needs that does not exist

| Needed | Why it is not just a column |
|---|---|
| **Adoption**, as an audited act with its own capability | who may turn a proposal into an obligation is a contractual question, not a UI affordance |
| **Time** | an obligation is in force over a period and is judged per period; a measure has none |
| **Evidence with custody** | a photograph submitted by a contractor is not the same kind of object as a chapter of a study; it needs an uploader, an instant, a hash and a place in object storage |
| **Site inspections** | an observation with a date, a place and an author — and personal data of workers is squarely in scope, which the compliance gate (SECURITY.md §10a) governs |
| **A finding vocabulary that *does* conclude** | the Quality Gate deliberately never says which side is right. An audit finding must, and that is a different contract with the reader — a different rule catalogue, not a new severity on the existing one |
| **Its own report** | periodic, addressed to an authority, and asserting compliance — the one thing the current report generator refuses to do |

## 4. What today's work already gives it

Not nothing, and this is the argument for having built the study stage first:

- **The measures themselves**, with a deterministic identifier (`PPMI-01.02.04`) that survives a
  re-import — so an obligation can name the measure it came from and still resolve next year.
- **The import-as-version shape**: a revised chapter supersedes rather than overwrites, so an
  obligation adopted from `v1` keeps pointing at the words that were adopted.
- **Faceted provenance** on every value, which is what makes an audit trail an audit trail.
- **Append-only decisions with mandatory justification** (`specialist_review`), already built,
  already proven — exactly the shape an `AuditFinding` needs.
- **The evidence locator union**, which now already carries a plan and a spatial layer, and would
  carry an inspection and an uploaded document the same way.
- **Two-sided findings**: the discipline that a finding shows both sides is worth keeping even when
  the second side is "what the evidence shows".

## 5. What must not happen in the meantime

1. **No compliance state on the PGAS surface**, however small. Not a tick box, not a "seguimiento"
   tab, not a column that is empty for now. An integration test asserts over `information_schema`
   that no column of the three PGAS tables can hold one, and that test is the guardrail.
2. **No `audit.environmental` enablement** for the pilot. It stays an extension, hidden.
3. **No borrowing of the Quality Gate's rules.** Its vocabulary is *possible inconsistency*, and its
   catalogue is asserted against that vocabulary. An audit rule concludes; mixing them would break
   the only guarantee the Quality Gate makes.

## 6. When this becomes the next product

When a project reaches construction with an approved plan and a contract that names the obligations
— i.e. when there is a real engagement to audit. Building it before then means inventing both the
obligations and the evidence, and a compliance module tested only against invented evidence is the
one thing worse than not having one.

**Recommendation: do not start until then.** The seam is drawn, the measures are stored, the
identifier is stable, and the day the first obligation is adopted the product will not have to be
rewritten to accommodate it.
