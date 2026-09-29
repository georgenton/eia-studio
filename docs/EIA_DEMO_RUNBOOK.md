# Demo environment runbook

The demo is a showcase. Its value is that it is **always in a known state**, which is a different
property from being up to date.

## What it runs

A **demo-certified digest**, chosen deliberately. It does not follow `main`, and it may lag
production. Nothing about a demonstration should change because somebody merged a pull request.

## Reset — destroy and rebuild, not delete-in-place

The reset is the recreation of the database, not a destructive command against a live tenant.
That is a deliberate choice (ADR-039 discussion): a `--reset` that deletes rows inside a running
tenant is one typo away from being pointed at the wrong environment.

1. Destroy the demo database resource and create it empty.
2. Migrate:

       docker run --rm --env-file <demo-env> <digest> node packages/db/dist/migrate.js

3. Provision the runtime role.
4. Provision the synthetic identities. The seeder never invents `app.user` rows; identities are
   created deliberately and the password lives outside the repository.
5. Seed:

       pnpm demo:eight-projects

`demo:eight-projects` is **idempotent**: every step is keyed by a natural identifier — tenant
slug, project slug, template key, parcel code, campaign name — and skipped when it already
exists. Running it twice changes nothing; running it after a partial failure completes it.

It refuses to run when `APP_ENV=production`, and it refuses when `DEMO_FIXTURES_ENABLED` is not
true. Both refusals are in the script and the second is also in the schema.

**A demo reset can never touch staging or production**: they are different databases with
different credentials, and there is no code path from one to another.

## What the demo contains

Tenant *Demo 8 Proyectos*, projects *Proyecto 1* … *Proyecto 8*, all `DEMO_SIMULATION`. They are
simulation identifiers, not roads: no invented road name, no invented owner, no invented address.
A product that fills the screen with roads that do not exist teaches people to trust screens that
mean nothing.

The presenter's script is `docs/CONSULTANCY_DEMO_SCRIPT.md`; the 25 September rehearsal is
`docs/DEMO_25_SEP_RUNBOOK.md`.

## What the demo must never have

Real customer data. Production identities. A live AI provider — a showcase that bills per
demonstration is a showcase nobody runs twice. `SOCIAL_CLASSIFIER`, `DOCUMENT_REVIEWER` and
`ASSISTANT_GENERATOR` stay unset, and unset means the surface says the feature is unavailable
rather than pretending.
