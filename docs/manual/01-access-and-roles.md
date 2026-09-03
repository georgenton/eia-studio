# 01 · Access and roles

## Signing in

The workspace is at `/sign-in`. There is **no public registration**: identities are provisioned
deliberately by an operator (`pnpm provision:identity`), which is why the sign-in page offers no
"create account" link and no password reset.

Passwords for the synthetic demo identities are supplied to the operator out of band and are never
written down here, in the repository, or in a log.

## The synthetic identities

All of them are on `demo.invalid`, a reserved domain that can never route anywhere real. They hold
no personal data: the names are job titles.

| Address                     | Name                      | Tenant role | Project role            |
| --------------------------- | ------------------------- | ----------- | ----------------------- |
| `admin@demo.invalid`        | Administradora del tenant | `ADMIN`     | _(none — deliberately)_ |
| `coordinadora@demo.invalid` | Coordinadora de proyecto  | `MEMBER`    | `COORDINATOR`           |
| `especialista@demo.invalid` | Especialista social       | `MEMBER`    | `SOCIAL_SPECIALIST`     |
| `tecnico@demo.invalid`      | Técnico de campo 1        | `MEMBER`    | `FIELD_TECHNICIAN`      |
| `tecnico2@demo.invalid`     | Técnico de campo 2        | `MEMBER`    | `FIELD_TECHNICIAN`      |

The tenant is `demo-consultancy`; the project is `puente-del-amor`. Every internal URL is
`/t/demo-consultancy/p/puente-del-amor/…`.

**The admin has no project data access on purpose.** An `ADMIN` administers the tenant — members,
roles, modules — and must take an explicit project membership to read parcels, responses or
codings. Opening a project surface as the admin shows a denial, and that denial is a feature.

## What each role sees

| Surface                                   | Coordinator     | Social specialist | Field technician     | Tenant admin                    |
| ----------------------------------------- | --------------- | ----------------- | -------------------- | ------------------------------- |
| Portfolio                                 | ✅ own projects | ✅ own projects   | ✅ own projects      | ✅ all (names, state, progress) |
| Command Center                            | ✅              | ✅                | —                    | denied                          |
| GIS / Parcel Explorer                     | ✅              | ✅ read           | ✅ read              | denied                          |
| FieldFlow (campaigns, assignments, inbox) | ✅ manage       | ✅ read           | own assignments only | denied                          |
| An individual response's answers          | ✅              | ✅                | own captures only    | denied                          |
| Social Intelligence — Tabulación          | ✅              | ✅                | denied               | denied                          |
| Social Intelligence — start a run         | —               | ✅                | denied               | denied                          |
| Social Intelligence — settle a coding     | —               | ✅                | denied               | denied                          |
| Tenant Settings                           | —               | —                 | —                    | ✅                              |

Two boundaries are worth exercising deliberately, because they are the ones most often assumed
rather than enforced:

- a **technician** signed in and typing another technician's assignment URL gets a **404**, not a
  denial: a distinguishable error would confirm the row exists;
- a **disabled capability** (`/reports`, for example) answers **404** for everyone, and the page
  never names the capability key or who could enable it.

## Signing out, and changing role

The topbar's right-hand side shows your name and role. Click it: the menu shows the address you are
signed in as and a **Cerrar sesión** button.

**To review the product as a different role, sign out and sign in as another identity.** There is no
role switcher, and there will not be one: a role here is a membership resolved on the server, so a
control that appeared to change it would either be lying about your session or performing a real
privilege change from a browser.
