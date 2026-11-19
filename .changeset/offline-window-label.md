---
"@eia/field": patch
"@eia/i18n": patch
---

The diagnostics screen shows a word for the offline window instead of the enum value.

`OfflineAccessState` is `valid | expiring | expired`, and the screen printed it raw, so a Spanish
diagnostics screen read "· valid". ADR-025: a stored value is never rendered; a label for it is.
The mapping is exhaustive by type, so a fourth state stops compiling rather than leaking a fourth
English word onto a Spanish screen.
