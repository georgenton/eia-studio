# 02 · Command Center

`/t/demo-consultancy/p/puente-del-amor` — the coordinator's answer to _are we on time, and what
needs attention today?_

## What is on the screen

| Panel                | What it counts                                           | Where the number comes from                                |
| -------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| Project header       | name, customer, lifecycle, profile                       | project record                                             |
| Operational KPIs     | visited / pending parcels, responses submitted, progress | counted from the tables at read time                       |
| Territorial summary  | parcels with and without geometry, by state              | the active spatial layers                                  |
| Operational forecast | days to close at the current pace                        | `pending ÷ 5-day moving average`, arithmetic in TypeScript |
| Activity             | recent operational events                                | `activity_event`                                           |

## Two things to check deliberately

**Every figure has provenance.** Click the provenance affordance beside a number: the drawer names
the regime (historical, live or demo), the origin, the transformations applied and the granularity.
Nothing on this screen is a bare number.

**The forecast is arithmetic, not AI.** The panel states the formula and its inputs, so the figure
can be reproduced by hand. The approved prototype shows a different projected delay than the
implementation does; the implementation follows the formula, and the discrepancy is recorded in
`docs/DESIGN_BUNDLE_KNOWN_ISSUES.md`. That is the rule for the whole product: a visual reference
decides how something looks, never what is true.

## What is demo data

The project is a reconstruction of a completed road study in Zamora Chinchipe. Its aggregate
historical figures are real and verifiable; the operational movement on this screen — visits,
revisits, productivity, the projected close, the activity feed — is **DEMO / SIMULATION** and every
badge on screen says so. See `docs/DEMO_ZAMORA.md`.
