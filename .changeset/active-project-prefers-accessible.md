---
"@eia/application": patch
"@eia/web": patch
---

The rail points at a project the reader can actually open.

At tenant scope the URL names no project, so the shell had to choose one for the workspace rail,
and it chose `projects[0]` — the oldest project of the firm. Listing a project and being able to
read it are different things (D-015): a tenant ADMIN sees every study by name and may be assigned
to one. Opening the Portfolio and clicking any module therefore sent an administrator into a
project they may list and may not read, and every entry answered `permission denied`. Observed on
staging with the coordination account, which administers the organisation and is COORDINATOR on
exactly one project.

`loadWorkspaceHeader` and `loadPortfolio` now report `accessible` per project, evaluated by the
database's own `app.has_project_access` — the same predicate the row-level policies apply, so the
rail cannot promise what the next request will refuse. `chooseActiveProjectSlug` prefers the first
accessible project; the project named in the URL still wins, and a caller who can open nothing
still gets a rail pointed at a refusal they can read rather than a shell that collapses.

No permission, policy or membership changed: this is the shell reading an authorization fact it
was previously guessing at.
