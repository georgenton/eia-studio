---
"@eia/application": patch
---

The demo seeder's orphan-provenance sweep is a registry, so the next provenance-bearing table cannot
be forgotten (TD-125).

Reloading a fixture removes the provenance records an older run left behind, and decides what is a
leftover by asking every table that can reference one whether it still does. That chain of `not
exists` subqueries was written by hand and had fallen **eleven tables behind the schema**: twenty
enumerated, thirty-one in the database.

The failure was not theoretical and not quiet. A local database that had ever run
`e2e/document-review.spec.ts` could **never be re-prepared**: the sweep tried to delete a record
`report_template_version` and `document_review_run` still pointed at, and the blocking rows could not
be removed either, because a review candidate is append-only by trigger (ADR-035). The only way out
was `pnpm db:reset:local`. CI never saw it, because its database is new every run — which is also why
a fixture-shaped test would not have caught it.

Six tables are added: `influence_area`, `document_review_run`, `document_review_candidate`,
`report_template_version`, `generated_document` and `field_media`. The other five —
`metric_snapshot`, `forecast_snapshot`, `attention_item`, `activity_event` and `provenance_input` —
are **deliberately not**, and the reason is recorded beside them: the seeder empties each of them
immediately before the sweep, so a clause would state a protection that does not exist. It would also
be the wrong direction to be wrong in. If one of those deletes ever moved to after the sweep, a
missing clause fails the re-seed on a foreign key — loud, and fixed in a minute — while a present one
would quietly keep stale records alive and leave the orphans the sweep exists to remove.

The enumeration now lives in `packages/application/src/projects/provenance-sweep.ts` and the SQL is
**generated from it**, so the list a test checks is the list the database executes. The registry test
is written against `pg_catalog` rather than against fixtures, in the shape of the project-scoping
registry already in this repository: it reads the foreign keys to `provenance_record` — a constraint
is what blocks the delete, not a column name, and the two already differ, because `provenance_input`
references the table twice — and fails the moment a migration adds a table nobody listed.

No schema change, no migration, no tenancy or security impact: the sweep was and remains scoped to
one project by a parameter, and nothing about RLS, capabilities or permissions is touched.
