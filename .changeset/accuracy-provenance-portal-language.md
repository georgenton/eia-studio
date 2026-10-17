---
"@eia/ui": patch
"@eia/domain": patch
"@eia/application": patch
"@eia/i18n": patch
"@eia/web": patch
---

Three accuracy fixes found by operating the product on a second, new project.

- A live operational aggregate no longer wears the *Dato histórico* badge: `REAL_AGGREGATE` now
  requires `regime = HISTORICAL_OBSERVED`.
- A client publication's withheld figures are derived from that project's own evidence instead of
  being seeded from a constant, so a project with no documents no longer claims the file records
  two conflicting figures, and a `LIVE_OPERATIONAL` campaign is no longer described as a simulation.
- The campaign activation refusal is read from the message catalogue rather than thrown in English,
  and the extractor's operator note is no longer appended to a Spanish sentence on screen.
