---
"@eia/application": minor
"@eia/domain": minor
"@eia/db": minor
"@eia/ui": minor
"@eia/web": minor
"@eia/worker": minor
---

Slice 3: FieldFlow and the survey foundation. Field capture becomes real — a coordinator's
campaign overview with progress counted from the tables, a mobile-first My Work for technicians,
and an assignment surface that opens a visit, renders the campaign's published questionnaire,
saves drafts and submits. One route serves both surfaces, chosen by permission rather than by role
name. The Parcel Workspace gains a Visits tab (state, questionnaire version and provenance — never
the answers) and the Command Center gains a field campaign panel, kept explicitly separate from
the concluded study's historical socioeconomic aggregate.

Eleven new tables (`project_configuration`, `survey_template`, `survey_version`,
`survey_question`, `survey_option`, `survey_campaign`, `field_assignment`, `field_visit`,
`survey_instance`, `survey_answer`, `survey_answer_option`) in migrations `0013` and `0014`, all
tenant- and project-scoped with composite foreign keys and `ENABLE` + `FORCE` RLS. Migration
`0015` adds the missing composite `(tenant_id, provenance_id)` foreign keys to the ten
provenance-bearing GIS and field tables, which ARCHITECTURE.md §5 always required.

A published `SurveyVersion` — its questions and its options — is immutable by database trigger,
and a submitted response is final: answers are typed columns with constraint triggers, not a JSON
blob, so an option code from another version cannot stand where a v1 option belongs. Reading an
individual response is its own permission (`field.responses.read`), separate from `field.read`,
and the row-level policies enforce technician ownership underneath it: a technician sees their own
assignments, visits, responses and answers and nothing else.

Closes architecture decision D-020 (ADR-018): offline capture is the project configuration
`field.surveys.offline_mode`, not a fifteenth capability, and `required` on the online-only web
channel fails at campaign activation rather than pretending. The demo campaign, questionnaire and
answers are deterministic, synthetic, free of personal data and labelled DEMO_SIMULATION; the
demo seeder derives provenance ids from the fixture key so re-seeding changes nothing that exists,
which `pnpm db:check-seeder-idempotency` now proves in CI.
