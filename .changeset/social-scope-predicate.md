---
"@eia/application": patch
---

Social's tally queries stated the campaign scope twice.

A targeted trace of the one route the performance baseline names as the outlier found a duplicated
`AND` of an identical correlated `EXISTS` in four of the tabulation's queries — the `SINGLE_CHOICE`,
`MULTI_CHOICE`, `BOOLEAN` and numeric branches — left behind by a mechanical edit when campaign
scoping arrived (ADR-026). It changed no result, which is why nothing caught it.

Removed: about 4 % on *Análisis social* locally, repeatable across two independent before/after
pairs, with the round trips unchanged at 83. TD-065 stays open, because the cost that matters is
still the tabulation's per-question loop, and rewriting that must not move a single figure.
