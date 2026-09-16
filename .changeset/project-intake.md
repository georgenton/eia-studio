---
"@eia/domain": minor
"@eia/application": minor
"@eia/db": minor
"@eia/i18n": minor
"@eia/web": minor
---

Project intake: *Preparar proyecto* / *Project setup*, the `PROJECT_DATA_MANAGER` role, and a
deterministic readiness report (ADR-030).

Eight stages of one page — no workflow engine, no stored wizard position — over the project as it
is, plus `evaluateReadiness`, a pure function of one snapshot. Seven rules with three outcomes and
two severities; only a blocked *required* rule stops activation, which moves one column and
recomputes the report server-side before it does. The D-020 offline gate is now reported during
preparation as well as refused at campaign activation.

`PROJECT_DATA_MANAGER` is a new project role with two new permissions (`project.intake.read`,
`project.intake.write`) and deliberately without `field.responses.read`, `pii.read`,
`quality.review`, `social.coding.review`, `portal.publish` or `project.configure`. Migration 0036
adds the enum value; the permissions are code, like every other role's.
