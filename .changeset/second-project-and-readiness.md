---
"@eia/web": minor
"@eia/i18n": minor
"@eia/field": minor
---

Study #2 through the product, and the readiness a go-live decision needs.

**A project can be created.** `createProject` has existed since Slice 0 and nothing called it: a
project could only be created by a developer running a script, which is fine for one pilot and
wrong for eight studies. *Nuevo proyecto* on the Portfolio — behind `projects.create` — takes a
name, a slug and a profile, and lands the person in *Preparar proyecto*, because creating a project
and preparing it are one act for whoever is doing it. Everything that makes a project a *study* is
still filled in by the intake (ADR-030); duplicating its fields on the Portfolio would create a
second place they can disagree.

`e2e/second-project.spec.ts` drives that path with no seeder and no SQL, then asserts the half that
matters: with two projects alive in one tenant, **every surface answers for the project in the URL
and for no other**. The new project shows its own emptiness rather than the pilot's figures, and the
pilot is unchanged by any of it.

Underneath, `wave3-two-projects.integration.test.ts` asks the question that scales past two:
*is there any project-scoped table whose policy forgot the project?* It enumerates every table in
`app` carrying `project_id` and asserts FORCE RLS, a policy naming `app.current_project_id()` — or a
declared delegation chain that reaches one — and the composite foreign key. A future table that
forgets fails the moment its migration lands.

**Native configuration is production-shaped.** Stable identifiers, a marketing version and a build
number, English permission strings beside the Spanish ones (`expo.locales`), and three EAS build
profiles — development, staging, production. `docs/FIELD_MOBILE_BUILDS.md` says exactly which four
owner actions remain, all of them accounts. Nothing is submitted anywhere.

**The physical UAT is 23 steps**, and says *PREPARED*, not *passed*: the display language switched
while offline, a photograph taken and one upload interrupted mid-sync, and the assertion that the
same answer codes survive whichever language the screen was in. No handset has run it.

**An operator can ask how a deployment is.** `pnpm ops:doctor` — read-only — reports queue depth and
age, stale claims, extraction and review failures, refused candidates, unreadable templates, field
media, sync receipts and audit freshness. Counts, states and ages: never an answer, a passage, a
candidate's text, a filename, an object key or a credential. A script rather than an endpoint,
because an unauthenticated diagnostics endpoint is an oracle for how busy a consultancy is.

New documentation: `PRODUCTION_RECOVERY.md` (RPO, RTO, restore order, verification, the field-device
outbox problem, secret rotation — and the fact that **no backup exists and no restore has been
tested**), `DATA_CLASSIFICATION_MATRIX.md` (ten data classes × where, who, retention, AI eligibility,
portal eligibility — with every legal basis marked OWNER / LEGAL REVIEW REQUIRED),
`GENERALISATION_AUDIT.md` (no pilot constant reached product code; every match is a comment
explaining why a design is what it is) and `FIELD_MOBILE_BUILDS.md`.

Migrations 0034 … 0047 were **applied to staging**, with the before/after baseline and the exact
table diff recorded, and `pnpm test:staging` passes 99 assertions against it — including eight new
ones for the Wave 3 tables' grants, policies, triggers and queue helper. Staging object storage
stays **blocked**: there is no bucket, and creating one is an owner action (TD-113).

No schema change in this release.
