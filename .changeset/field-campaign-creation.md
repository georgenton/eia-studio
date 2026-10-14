---
"@eia/application": minor
"@eia/domain": minor
"@eia/i18n": minor
"@eia/web": minor
---

A project with parcels and a published questionnaire can open the operation that field work
belongs to. `createSurveyCampaign` creates a DRAFT against a PUBLISHED `SurveyVersion` of the same
project, behind `field.campaigns.manage`; *Asignación de predios* offers the control where the
dead end used to be, and the existing assignment board and `activateCampaign` do the rest.

Activation now refuses a second active campaign in a project, naming the one that is running. It
does not close it: superseding an operation is a decision somebody makes on purpose, and ending
field work as a side effect of starting other field work is not that decision.

The audit vocabulary gains `field.campaign.created`.
