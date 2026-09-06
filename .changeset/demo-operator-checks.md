---
"@eia/application": patch
"@eia/db": patch
---

Two read-only operator commands, and a statement timeout that actually reaches the server.

Demonstrating this product to a consultancy has one recurring failure: the environment is not the
one the operator thinks it is, and nobody finds out until a screen is empty in front of an audience.
`pnpm demo:preflight` answers *is this environment in step with the code?* — migrations against the
repository's journal, PostGIS, the runtime role without `BYPASSRLS`, RLS forced on every table, the
address and the demo credential's presence. `pnpm demo:doctor` answers *does this project have what
the walkthrough shows?* — twenty checks over the study's title, the cartography, the parcels and
their geometry, the measured centreline, the current field operation, the management plan, the
findings, the documents, the report versions, the codings, the five identities and whether assisted
coding is configured.

Both are selects. Neither seeds, repairs or resets anything, in any environment: a tool that fixes
what it finds is a tool nobody can trust to report. Neither prints a password, a token, a connection
string or the text of an answer, and two conditions are deliberately hard failures — a dangling
`provenance_id` (a *Ver origen* that opens on nothing withdraws invariant 4 in front of the
audience) and rows written by the deterministic fake classifier in a persistent environment
(IG4-001: once stored, a fake proposal and a model's proposal are the same row).

The pool change is a bug: `SET statement_timeout` was issued as a fire-and-forget query on connect,
which raced the first real query and drew a node-postgres deprecation warning. It is now the
connection's `options` startup parameter, so the limit is in force from the first statement.
Migrations, seeds, provisioning and the test migrator pool opt out with `statementTimeoutMs: null`,
as before.
