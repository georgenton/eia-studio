---
"@eia/domain": minor
"@eia/db": minor
"@eia/ui": minor
"@eia/web": minor
---

Implementation Gate 1 adjustments.

One capability route policy, resolved in a single place (ADR-016): a capability that is not
effective answers 404, identical to a URL that means nothing, because the `feature disabled` copy
named the capability and who could enable it and so disclosed another party's configuration at a
guessable URL. A capability that *is* effective but whose surface is not built yet gets an
explicit inert state instead, and navigation presentation cannot widen either outcome.

The demo simulation gains an explicit clock. `project.demo_scenario_date` fixes the as-of date of
a project's simulation, the fixture states it once and every demo instant derives from it, and the
UI names it ("Escenario demo · fecha de corte: 17 sep 2026"). Historical facts keep their own
capture dates. The forecast already took its anchor as an input; tests now prove the output does
not move with the machine's clock.

`@eia/ui` no longer depends on a framework: components that construct routes moved to the
application, the provenance drawer takes an `onClose` callback, and a test fails if a router
import returns. `MetricSnapshot`'s scope is documented and pinned as a curated Command Center
projection, not an analytics store. An axe smoke suite now runs over four states in CI, which
found a real contrast defect in the label palette; the muted token is corrected.
