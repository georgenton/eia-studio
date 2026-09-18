---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/i18n": minor
"@eia/field-sync-contract": major
"@eia/web": minor
"@eia/field": minor
---

A correction is a new response, and one resolver says which one counts (ADR-038).

A submitted response is still never edited. Correcting one means capturing a **new** one on a
revisit assignment — same campaign, same parcel, same questionnaire — with `survey_correction`
recording which response it replaces, why and who asked. History keeps both; current analytics count
exactly one.

`app.effective_survey_instance` is the single place that answers *which response does this study
mean?*, joined by social tabulation, the numeric summary, validated themes, field progress and the
report snapshot alike. Requesting a correction is the new `field.corrections.request`, held by
COORDINATOR and SOCIAL_SPECIALIST.

`FIELD_SYNC_PROTOCOL_VERSION` moves to **3**: the Field Pack's assignment carries why a technician
is being sent back (and no previous answer), so a device built against version 2 must be rebuilt.
