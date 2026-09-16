---
"@eia/i18n": minor
"@eia/domain": minor
"@eia/ui": minor
"@eia/application": minor
"@eia/db": minor
"@eia/field-sync-contract": minor
"@eia/testing": minor
"@eia/web": minor
"@eia/field": minor
---

The product is bilingual: Spanish and English from one message catalogue, on the web and on the
phone, and a questionnaire that is one `SurveyVersion` in two languages rather than two
questionnaires (ADR-029).

The Spanish label constants are removed from `@eia/domain` and `@eia/ui` — both now hold values,
rules and glyphs, and no copy. Surfaces resolve the locale once and pass `{ locale, t, fmt }` down.
Two new tables (`survey_question_translation`, `survey_option_translation`, migrations 0034/0035)
carry a questionnaire's other languages as part of its frozen definition, and the Field Pack ships
them so an offline phone can still switch language. Invariants 10 and 11 are now asserted over every
message in both catalogues.
