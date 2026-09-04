---
"@eia/db": patch
"@eia/web": patch
---

Resolve the caller in one transaction instead of four.

Every project page spent 17 database round trips deciding who was asking, and 12 of them were
transaction framing rather than questions: four transactions — reconcile the user, resolve the
tenant, resolve the project with its memberships and overrides, and re-read the tenant's capability
rows for the shell — each paying `BEGIN`, a five-part `set_config` and `COMMIT` before asking
anything (`docs/PERFORMANCE_BASELINE.md` §6, TD-064).

They are now one. The **row-level envelope is unchanged**, which is the whole point of doing it as
its own change: the user row is still reconciled with only `app.user_id` set, the tenant is still
proved by a membership join with `app.tenant_id` **unset** — so a slug the caller supplied never
becomes the tenant they are read as — and only then is the proven tenant adopted
(`adoptTenantContext`) for the project, membership and capability reads, with `app.project_id` left
unset so project access still comes from membership. `SET LOCAL` expresses that ordering inside one
transaction exactly as two transactions did; what disappears is the framing.

Measured on the same machine, the same seeded project and the same driver, before and after:
context round trips **17 → 12** on every project route and **14 → 9** on the Portfolio, with
**13 fewer round trips per page** overall — the other eight are two reads that no longer happen at
all, because the application user row was being reconciled twice per render and the shell was
re-reading capability rows the authorization path had just read. Wall clock barely moves locally,
where the database is a container; the count is what geography multiplies.

`packages/application/test/request-context-envelope.integration.test.ts` covers the merged envelope:
a foreign tenant, a foreign project under an adopted tenant, an unassigned project of the right
tenant, two memberships of one person kept apart with their own settings, no tenant left on the
pooled connection, and a denied resolution that writes nothing.
