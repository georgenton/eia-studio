# 04 · FieldFlow for a coordinator

`/t/…/p/…/field`, signed in as `coordinadora@demo.invalid`.

One route serves two different screens, chosen by **permission** rather than role name: a caller
with `field.read` gets this one; a caller with only `field.assignments.read_own` gets _My Work_
(page 05).

## What the coordinator sees

- **_Operativo actual_** — the campaign running now, the **questionnaire version** it captures
  against, the **capture channel** and whether that channel supports offline;
- **_Operativo anterior_**, for each earlier operation the project ran. It is closed and complete —
  every assignment, visit and submitted response still there — and it takes no part in today's
  progress, the tabulation's denominator or a report snapshot (ADR-026). A project accumulates
  these; only one of them is what "pendientes" means today;
- **progress counted from the tables** — assignments, visits, responses submitted — never a stored
  running total that could drift;
- **workload per technician**: counts only. A coordinator sees how much a technician has done, not
  what any household answered, until they open a response.

## The inbox of submitted responses

Submitted responses only; drafts never appear and never enter a figure anywhere in the product.
Opening one requires `field.responses.read`, which a technician and a GIS specialist do not have.

## What cannot be done, and why

- **An answer cannot be edited.** Not a word, not a spelling correction. A submitted response and
  its answers are refused by the database. A correction is a new visit, and the superseding
  workflow is not built yet (TD-036).
- **A published questionnaire version cannot be changed.** Refinement publishes a new version, and
  responses stay readable against the version they were captured on.
- **Offline capture does not exist yet.** `field.surveys.offline_mode = required` refuses to
  activate a campaign, because the web capture channel declares no offline support (TD-035).
- **A campaign's parcels are not edited after the field work starts.** A campaign records an
  operation, not a plan: when the intended coverage changes, the operation that ran is **closed**
  and a new one opens. Nothing is deleted, and the old campaign keeps everything it did (ADR-026).
