---
"@eia/domain": minor
"@eia/db": minor
"@eia/web": patch
---

Move the demo simulation's as-of date off the canonical `Project` entity (IG1-009).

`project.demo_scenario_date` put a demonstration concern on the entity every module builds on, and
would have made every real project carry a column that means nothing to it. The date belongs to
the calculation it anchors, so it is now `forecast_snapshot.as_of_date` — which also completes the
forecast's input snapshot, so the result can be recomputed from the row alone. For a
`DEMO_SIMULATION` forecast that anchor is the scenario clock, and its provenance regime already
says so; `demoScenarioDate(forecast, provenance)` is the whole rule. No scenario entity, no
scenario table, no scenario subsystem.

The fixture stays the authoritative source of the scenario date and remains fixture metadata: at
seed time it becomes persisted timestamps on the rows that own them. Historical observed values
keep their own capture dates and never inherit the scenario.

Forward-only migration; 0007 is not rewritten. It adds the column nullable, backfills existing
rows from `calculated_at`, then constrains it, because the generated one-statement `NOT NULL` add
would have failed on a table that already has rows.
