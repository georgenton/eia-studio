# Preflight: what to verify before showing EIA Studio to the consultancy

> The half hour before the walkthrough. `docs/CONSULTANCY_DEMO_SCRIPT.md` is what to say;
> `docs/manual/10-demo-walkthrough.md` is the operator's route list; this is the list of things that
> have actually gone wrong, and how to find out that they have — **before** somebody is watching.
>
> Everything here is **read-only**. No step of this document mutates staging: no seed, no repair, no
> reset, no lifecycle change. If a check fails, the remedy is a decision taken with time to spare,
> not a fix improvised during the meeting.

## 0 · The two commands

```bash
pnpm demo:preflight
```

```bash
pnpm demo:doctor
```

`demo:preflight` asks *is this the environment I think it is, and is it in step with the code?* —
migrations applied against the repository's journal, PostGIS present, the runtime role without
`BYPASSRLS`, row level security forced on every table, the address the demonstration will be given
from, the demo credential present in the environment.

`demo:doctor` asks *does this project have what the walkthrough shows?* — the study's title, the
cartography, 141 parcels with geometry, the measured centreline, the areas of influence, the current
field operation, the management plan, the consistency findings, the documents and their passages,
the report versions, the taxonomy and its validated codings, the five identities, and whether
assisted coding and the document assistant are configured.

Both print `OK` / `WARN` / `FAIL` lines and exit non-zero only on `FAIL`. Neither prints a password,
a token, a connection string or the text of an answer.

Against staging, both run through the environment's own credentials:

```bash
railway run --service worker --environment staging pnpm demo:preflight
```

## 1 · The environment (from `demo:preflight`)

| Check | What a failure means | What to do |
|---|---|---|
| **base de datos** | the host and database the command reached | if it says `localhost`, you are checking your laptop and not staging: re-run through `railway run` |
| **esquema** | staging is behind (or ahead of) the repository's migrations | a `main` that deployed but did not migrate. Apply the migrations, or demonstrate the commit staging actually has |
| **extensiones** | PostGIS or `pg_trgm` missing | the map and the document search will fail. This is not demonstrable; stop and fix it |
| **rol de ejecución** | `eia_app` missing, or holding superuser / `BYPASSRLS` | isolation is not being enforced. Do not demonstrate isolation claims until it is |
| **aislamiento** | a table without `FORCE ROW LEVEL SECURITY` | same. The number of tables is the number of holes |
| **dirección de la demostración** | no `PREVIEW_URL` / `PUBLIC_APP_URL` | you must confirm by hand which URL you will open, and that it is the one pointing at this database |
| **credencial de las identidades** | `DEMO_USER_PASSWORD` absent | nobody can sign in. The value is never printed and never committed (SECURITY.md §12a) |

## 2 · The project (from `demo:doctor`)

The doctor's twenty checks map onto the script's nine beats. Read them in that order:

| Beat | Checks that must be green | The failure the audience would see |
|---|---|---|
| 1 · Centro de control | `proyecto`, `título oficial` | the header naming something other than the study, or a project that is not there |
| 2 · Cartografía | `cartografía importada`, `predios`, `eje vial`, `áreas de influencia`, `afectaciones` | an empty map, or 141 parcels with no geometry |
| 3 · Trabajo de campo | `operativo actual` (**ACTIVE**), `operativos cerrados` | the surface opening on a closed operation, or on none — ADR-026 and PR #21 |
| 4–5 · Análisis social | `taxonomía`, `codificaciones`, `validaciones` | a coding queue with nothing in it |
| 6 · Control de consistencia | `hallazgos` | a gate with no findings, which reads as a gate that does not work |
| 7 · Documentos | `documentos`, `versiones`, `pasajes` | citations that resolve to nothing |
| 8 · Plan de Manejo | `plan de manejo` (plans · programmes · measures) | the chapter's import missing or superseded by an empty one |
| 9 · Informes | `versiones de informe` | no draft to open |
| throughout | `origen del dato` (no dangling provenance) | a *Ver origen* that opens on an empty drawer |
| throughout | `identidades` (five) | a role the script promises to switch to and cannot |
| AI | `codificación asistida`, `asistente documental` | see §3 — not a failure, a thing to know before you are asked |

Two doctor checks deserve their own line, because they are the ones that would put something false
on screen rather than nothing:

- **`clasificaciones simuladas`** is a **FAIL** in any persistent environment. A proposal written by
  the deterministic fake and a proposal written by a model are the same row once stored, and a
  reviewer cannot afterwards tell them apart (IG4-001, SECURITY.md §10c.1).
- **`origen del dato`** counts rows whose `provenance_id` resolves to nothing. Invariant 4 is the
  product's central claim; a drawer that opens empty withdraws it in front of the audience.

## 3 · Assisted coding and the document assistant

Both may legitimately read `no disponible · NOT_CONFIGURED`, and that is a **WARN**, not a failure.
No model provider is configured, no paid call is made, and the deterministic half of the product —
tabulation, denominators, the consistency rules, the report snapshot — works exactly the same.

Decide **before** the meeting which of the two things you are showing:

1. **Without a provider.** The coding queue shows the *AI no disponible* state and says which of the
   three reasons it is. The honest sentence: «la parte determinista funciona; la asistida está
   apagada porque no hay proveedor configurado, y el producto lo dice en vez de inventar un
   resultado.»
2. **With a provider.** Requires an owner authorisation that has not been given at the time of
   writing. `docs/AI_MODEL_SELECTION.md` records what would be selected and why.

Never demonstrate the deterministic fake as if it were assisted coding.

## 4 · The hosting surfaces

Neither command reaches Vercel or Railway; check them by hand, and check them **in this order**,
because a healthy database behind a stale deployment is the failure that looks like a product bug.

| | Verify | Where |
|---|---|---|
| Vercel | the latest deployment of `main` is **Ready**, and its commit is the one you intend to show | project → Deployments |
| Vercel | the hostname you will open is the stable staging alias, not a per-commit preview URL that will 404 tomorrow | project → Domains |
| Railway | the `worker` service is running and not in a restart loop | service → Deployments / Logs |
| Railway | the database service is up and its public proxy answers | service → Settings → Networking |
| Both | the web app and the worker point at the **same** database as the one `demo:preflight` reported | variables (names only; never copy a value into a document or a chat) |

Open the workspace once, sign in, and let the Centro de control finish loading. A first request
after an idle period pays for a cold start and a new connection; paying for it now means the
audience does not.

## 5 · Ten minutes before

- [ ] `pnpm demo:preflight` against staging — `0 FAIL`
- [ ] `pnpm demo:doctor` against staging — `0 FAIL`
- [ ] The deployment shown is the commit you rehearsed on
- [ ] Signed in as `coordinadora@demo.invalid`; the other four identities' credentials to hand
- [ ] The workspace opened once so the first page is warm
- [ ] `docs/CONSULTANCY_DEMO_BRIEF.md` open in a second window for the questions to ask
- [ ] A copy of `docs/CONSULTANCY_FEEDBACK_TEMPLATE.md` to write into during the session

## 6 · If a check fails while you are already late

The order of preference is: **show less, never show something false.**

| Failure | Response |
|---|---|
| Schema behind | demonstrate the deployed commit and say so; do not migrate under time pressure |
| A surface's data missing | drop that beat from the script. The nine beats are independent |
| Current operation not ACTIVE | do not open Trabajo de campo. Do **not** repair lifecycle state by hand — it is an audited transition, and doing it hurriedly is how the drift of PR #21 happened |
| Fake classifications present in a persistent environment | do not open Análisis social's coding queue at all |
| Anything at all in `aislamiento` | do not make the isolation claim; say the check exists and that it is currently red |

Nothing on this list is repaired by `demo:preflight` or `demo:doctor`, by design. An operator tool
that fixes what it finds is an operator tool nobody can trust to tell them the truth.
