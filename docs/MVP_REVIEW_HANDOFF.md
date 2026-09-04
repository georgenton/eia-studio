# MVP review hand-off

> The end of the sustained MVP development wave authorised on 3 September 2026. Everything below is
> what exists, verified, on `main` — not what is planned. Written for a manual walkthrough by the
> owner, and for the decisions that walkthrough will need to produce.
>
> **Nothing here has been deployed to production. The `production` branch is untouched.**

## 1. Where to look

| | |
|---|---|
| Stable Preview | **https://eia-studio-web-git-main-georgentons-projects.vercel.app** — tracks `main`, redeployed on every merge |
| Walkthrough to follow | [`docs/manual/10-demo-walkthrough.md`](manual/10-demo-walkthrough.md) — five role journeys, in order, each with what to check |
| Manual | [`docs/manual/`](manual/README.md) — pages 01–10, all current |
| Screenshots | [`docs/screenshots/`](screenshots/) — slice-1 … slice-7, regenerated from the passing e2e suite |
| Credentials | `DEMO_USER_PASSWORD`, held by you. It is not in this repository, not in any document here, and not in any log |

The Preview is behind Vercel's deployment protection, so you will be asked to authenticate to
Vercel first, then to EIA Studio.

## 2. The synthetic identities

All on `demo.invalid`, a reserved domain that cannot route anywhere real. They hold no personal
data: the names are job titles. One password for all of them.

| Address | Tenant role | Project role | What the walkthrough uses them for |
|---|---|---|---|
| `admin@demo.invalid` | `ADMIN` | *(none, deliberately)* | proving an administrator has **no** implicit access to project data |
| `coordinadora@demo.invalid` | `MEMBER` | `COORDINATOR` | the main journey: Command Center → GIS → FieldFlow → Social → Quality → Documents → Reports |
| `especialista@demo.invalid` | `MEMBER` | `SOCIAL_SPECIALIST` | assisted coding and specialist validation |
| `tecnico@demo.invalid` | `MEMBER` | `FIELD_TECHNICIAN` | capturing a visit on a phone; seeing only their own work |
| `tecnico2@demo.invalid` | `MEMBER` | `FIELD_TECHNICIAN` | proving one technician cannot see another's |
| `revisor@demo.invalid` | `MEMBER` | `REVIEWER` | settling a Quality Gate finding |

Tenant `demo-consultancy`, project `puente-del-amor`.

## 3. What the wave built

| Slice | Merged | What it added |
|---|---|---|
| 4 (closed in this wave) | `7072e88` | IG4-001 closed: `SOCIAL_CLASSIFIER` has no default and the fake runs only in `local`/`test`. UX-001 closed: an account menu with `Cerrar sesión`, no role switcher |
| 5 — Quality Gate | `7a4012a` | five deterministic rules that say two sources disagree and never which is right; append-only specialist review with a mandatory justification; re-runs reconcile on a fingerprint |
| 6 — Document intelligence | `4daf9eb` | immutable document versions and chunks; PostgreSQL full-text retrieval that says on screen that it is lexical; an assistant that may cite only what was retrieved; the Quality Gate's evidence gained a passage link with **no finding rewritten** |
| 7 — Report generation | `b8e9fc0` | the social chapter as a versioned snapshot in which every fact carries a typed source; prose is optional and generated from the snapshot; versions are written once; a .docx that says BORRADOR on its face |
| MVP integration | *(this branch)* | the walkthrough as a test; a measured performance baseline; one breadcrumb fix |

`reports.social_generator` was the last ANNOUNCED capability. All eleven capabilities of the
`road_eia_social` profile are now built, and the navigation rail has no placeholder row left.

## 4. Verification, as it actually stands

| Suite | Result |
|---|---|
| Unit and domain | **283 passed** |
| Integration (Testcontainers, RLS, cross-tenant harness) | **353 passed** |
| End to end (Playwright, 8 role projects) | **150 passed**, nothing skipped |
| Accessibility (axe, every surface) | no serious or critical violations |
| Staging (non-destructive) | **90 passed**; migrations 22 → 24 applied forward; baseline diff before and after shows only the migration count |
| Lint · format · typecheck · build | clean |
| CI on `main` | green at every merge |

**No model was called anywhere, at any point.** No `AI_GATEWAY_API_KEY` exists in any environment
(TD-049), so assisted coding reports `BLOCKED_EXTERNAL_CONFIG`, the document assistant answers with
passages and no narrative, and every generated chapter has no prose — each of which is the designed
behaviour rather than a degraded one.

## 5. Performance, measured

Full detail in [`docs/PERFORMANCE_BASELINE.md`](PERFORMANCE_BASELINE.md). The short version:

- The web functions run in Vercel **`iad1`** (US East); the database is on Railway **`us-west2`**
  (US West), reached over a **public** TCP proxy. Opposite coasts.
- On a *local* database with sub-millisecond latency, every project page already makes **37 to 95
  database round trips**, and **17 of them are spent deciding who is asking** — of which **12 are
  transaction framing**, because the request context is built across four separate transactions.
- 62 % to 95 % of a route's wall clock is inside the driver before geography is considered. Social
  Intelligence is the outlier: 78 page queries, 377 ms locally.
- The `read ECONNRESET` you saw is consistent with a single connection failure on a long-haul path
  over public networking. Nothing suggests a capacity problem.

**Nothing was changed in response.** Fixing the *count* is worth more than fixing the *distance*,
and both are recorded as debt with their costs (TD-064 … TD-067). Moving the database or the
functions is your decision, and the baseline says how to measure the real cross-coast cost first
(§7 of that document).

## 6. Known limitations, stated plainly

These are deliberate and documented, not oversights.

| | |
|---|---|
| **No production** | Nothing has ever been deployed to production. The hosting decision (ADR-012) and the compliance review (SECURITY.md §10a) are both still open |
| **No real data** | Every figure outside the four historical aggregates is demo or reconstructed, and labelled on screen. The compliance gate that would allow real personal data is unopened |
| **No language model** | Nowhere. See §4 |
| **Retrieval is lexical** | PostgreSQL full-text, not semantic. A question phrased differently from the document finds nothing, and the surface says so (TD-057, ADR-021) |
| **No approval workflow** | A report version is always `DRAFT`. `deliverables.approve` exists as a permission and nothing consumes it, which is why the .docx says BORRADOR (TD-060) |
| **No Client Portal** | The route is a capability-guarded placeholder |
| **No document upload** | Documents are text excerpts ingested from a fixture; there is no upload, no PDF parser, no OCR (TD-056) |
| **A human review cannot be corrected** | A submitted coding is final by design; there is no supersede (TD-041) |
| **Social analytics need `field.responses.read`** | A viewer without it is denied rather than shown zeros, which would be a plausible and entirely false tabulation (TD-045) |
| **Staging TLS is unverified** | `sslmode=no-verify` against a self-signed certificate. Acceptable only because staging holds synthetic data; production must be `verify-full` (TD-016) |
| **Staging has no backups** | Railway refuses both mechanisms for this workspace, so the staging database is disposable by design (DEPLOYMENT.md §4b) |

## 7. What needs a decision from you

Not from this session, by construction — each is a hard stop the brief reserved.

1. **The AI Gateway credential.** Without it, assisted coding and generated prose cannot be
   demonstrated at all. With it, real text would leave the system, so the demo-only gate
   (SECURITY.md §10c) is what stands between a credential and a compliance question.
2. **Region.** Whether to move the functions to the database's region, or the database to `iad1`.
   Measure first (PERFORMANCE_BASELINE §7); a database migration is destructive-adjacent.
3. **Production hosting and the compliance review.** Both gate any real project.
4. **Whether the context-transaction consolidation (TD-064) is worth its risk.** It is the largest
   single performance win available and it changes the RLS envelope of the authorization path,
   which is why it was recorded rather than done inside a hardening pass.

## 8. Remaining debt worth your attention

Sixty-one entries in [`docs/TECH_DEBT.md`](TECH_DEBT.md), each with an owner and a removal trigger.
The ones that would affect a decision rather than a future sprint:

| | |
|---|---|
| TD-049 | no AI credential anywhere — **owner** |
| TD-016 | staging TLS is not verified — **owner**, before production |
| TD-064 · TD-065 | the round-trip count, and Social's 78 queries |
| TD-060 | no approval workflow for a generated chapter |
| TD-044 | AI-vs-human coincidence is agreement, never accuracy, and `HumanReview` is not a gold standard |
| TD-055 | system state 15 has no reachable route, now that every surface is built |
| TD-068 | the technician e2e specs consume a pending assignment per run; CI is unaffected, local needs `pnpm db:reset:local` |

## 9. How to check that this document is honest

Every claim above is reproducible:

```bash
pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:integration
DEMO_USER_PASSWORD=… pnpm e2e:prepare && DEMO_USER_PASSWORD=… pnpm e2e
```

The staging figures come from `pnpm test:staging` against the persistent environment with the
baseline captured before and after. The performance figures come from `pnpm perf:baseline`.
