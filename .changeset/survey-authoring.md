---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/i18n": minor
"@eia/field-sync-contract": major
"@eia/web": minor
"@eia/field": minor
---

A questionnaire is written inside the product, and a published one is never edited (ADR-037).

*Preparar proyecto* → *Formularios* is now where a `SurveyVersion` comes from: questions, their
order, their options, their headings and their second language, behind `field.instruments.author`;
publication is the separate `field.instruments.publish`, held by the coordinator alone. A published
version stays frozen by trigger, and a correction is the next version copied from it.

`FIELD_SYNC_PROTOCOL_VERSION` moves to **2**: the Field Pack's question carries a `section`, and the
pack's schemas are `.strict()`, so a device built against version 1 must be rebuilt.
