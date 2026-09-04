# What this product does for a consultancy, and where it is going

> Related: `docs/PRODUCT.md` (the approved design in product terms), `docs/ZAMORA_WORKSPACE.md`
> (what is real in the pilot workspace), `docs/IMPLEMENTATION_PLAN.md`, `docs/TECH_DEBT.md`.
>
> Written to be readable by an environmental consultant rather than by an engineer. It describes
> **what exists today** and, separately, what does not. Nothing in the second half is a commitment.

## 1. The problem, in the words of the people who have it

An environmental and social impact study is produced by five or six people working in different
tools: a GIS specialist with a geodatabase, technicians with paper sheets and a phone, a social
specialist with a spreadsheet of open answers, a coordinator with a schedule, and whoever finally
writes the chapters in Word. The study is delivered as a folder of files.

Three things go wrong, every time, and none of them is anybody's fault:

- **The same fact appears in two documents with two values.** 71 affected parcels in the annex, 70
  in the report. Somebody notices at the review, or nobody does.
- **Nobody can say where a number came from.** A figure in the social chapter was calculated from a
  spreadsheet that was filtered, and the filter is in somebody's head.
- **The field work is invisible until it is finished.** A coordinator learns the pace of a survey by
  asking.

## 2. What EIA Studio does about it today

| For | It does | And the reason it is trustworthy |
|---|---|---|
| The coordinator | one operational view of the study: what is done, what is pending, and the pace it is going at | the projection is arithmetic that states its own formula and inputs, so it can be reproduced by hand; it is never presented as a prediction |
| The GIS specialist | the study's own cartography imported as it is — the centreline, the parcels, the affected areas, the areas of influence — with its measurements computed rather than declared | personal attributes are removed before a file enters the system, and the map legend says what each layer *is*: a study survey is not an official cadastre, and the screen says so |
| The field technician | their own assignments on a phone, with the questionnaire the campaign published | an answer is immutable once submitted; a correction is a new visit, never an edit |
| The social specialist | closed-question tabulation with the denominator stated in words, and assisted coding of open answers | the model **proposes**, a person **validates**, and analytics count only what the person validated; the model's score is labelled a score and never a probability |
| The reviewer | the disagreements between two sources of the study's own file, each with both sides and neither called the error | a decision is permanent and carries a written reason; a change of mind is a second decision, not an edit |
| Whoever writes the chapter | a draft in which every figure carries the source it came from | the deliverable is the sourced snapshot; the prose is a rendering of it, and a paragraph that states a figure its section did not compute fails the generation |
| Everyone | one drawer that answers "where does this number come from?" on any figure, layer, finding or report | the answer is four facts recorded when the value was written, not a label somebody typed |

## 3. What it deliberately does not do

| Not built | Why not, and what would have to be true first |
|---|---|
| Declare compliance | the product reports that two sources disagree. Saying which is right is a professional judgement with legal weight, and it belongs to the specialist who signs the study |
| Track execution of the management plan | the plan the study proposes and the record of somebody carrying it out are different products (ADR-024 §7). The second needs obligations, evidence and periodic checks, and a project that has actually started |
| Hold real personal data | the compliance review under Ecuador's data-protection framework has not happened (SECURITY.md §10a). Until it does, the system holds aggregates, anonymised layers and synthetic demonstration records |
| Send anything but demonstration text to a model | the gate is in the domain and is checked twice; a specialist with every permission cannot send a historical answer to a provider |
| Work offline in the field | the capture channel declares no offline support, and a campaign that requires it cannot be activated (ADR-018). Building it is a sync protocol, not a switch |
| A client-facing portal | designed, not built. It is a separate surface with its own database role and its own projection, so that a client can never be shown an internal table by accident |
| Climate analytics and environmental audit | catalogue extensions, hidden. They are real products in their own right and neither is started |

## 4. Where the value compounds, if it does

The order matters more than the list. Each of these is worth building only after the one above it
is being used on a real study, because each depends on data the previous one produces.

1. **A second project.** Everything the pilot proves is proven once. A second study is what turns
   the profile mechanism from a design into a fact, and it is the only way to find out which of the
   pilot's assumptions were the pilot's.
2. **Cross-document checks that reach the cartography.** A plan naming an area of influence the map
   does not contain is the check this material is asking for, and it needs both halves imported —
   which they now are (TD-072).
3. **The client portal.** A customer who can see progress without being sent a PDF is the most
   visible value the design already contains and the one with the clearest boundary.
4. **The audit stage.** Once a study is approved and work starts, the management plan stops being a
   document and becomes obligations. That is the second product, and the seam is already drawn.
5. **Semantic retrieval.** The assistant cites what it finds; today it finds by words. A vector
   store is an added implementation of a port that already exists (ADR-021) — worth adding when
   somebody is losing a real passage to lexical search, not before.

## 5. What would make this document dishonest

Adding a roadmap with dates, or a feature nobody has been asked for. The list in §4 exists so that
the answer to "what next?" is a decision the owner makes with the evidence in front of them, not a
plan the code has already assumed.
