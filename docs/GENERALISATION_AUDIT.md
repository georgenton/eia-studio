# Generalisation audit — is the pilot in the product?

> Wave 3. The question eight studies force: **does this product know about Zamora?** Related:
> CLAUDE.md rule 3, `docs/DEMO_ZAMORA.md`, ADR-003 (profiles).
>
> Run before study #2 was prepared, and again after. The answer is recorded here rather than
> asserted, because "we checked" is not a finding.

## 1. What was searched, and where

Every occurrence, in **product code only** — `packages/domain/src`, `packages/ui/src`,
`packages/i18n/src`, `packages/db/src`, `packages/application/src`, `apps/web/{app,components,lib}`,
`apps/field/src`, `apps/worker/src`. Fixtures, seeds, tests, documentation and ADRs are excluded on
purpose: those are **where the pilot belongs**.

| Term | What it would mean as a leak |
|---|---|
| `puente-del-amor` | the pilot's slug decided something |
| `Zamora`, `Yantzaza` | the pilot's province or canton is a product constant |
| `EC-L1289` | the programme reference is compiled in |
| `141`, `119`, `185`, `7.4` | the pilot's figures are defaults |
| `DOC-001` … `DOC-006` | the pilot's document codes are known to the product |
| campaign ids, GIS dataset ids | a specific operational run is referenced |
| `road_eia_social` | the profile key — a design artefact, not a pilot one |

## 2. Findings

**No product leak.** Every match is one of three classes.

| Class | Count | Examples |
|---|---|---|
| **Comment or docblock** citing the pilot as the motivating case | all numeric matches | `gis/bounds.ts`: *"20 of 141 parcels are multi-part (ADR-023)"*; `gis/read-models.ts`: *"the pilot has 141, whose geometry serialises…"*; `social/read-models.ts`: *"a screen that says '0 de 141 respuestas'…"*; `ui/metric.tsx`: *"Compact figure used on Portfolio cards (`PREDIOS 141`)"* |
| **Usage example** in a script's own help text | 1 | `apps/web/scripts/provision-identity.ts`: `--project puente-del-amor` |
| **Design artefact**, not a pilot fact | 1 | `road_eia_social` — the first project profile (FEATURES.md §5.1), generic to linear-corridor road studies, carrying no pilot data |

The numeric matches are the interesting ones, and they are all the same shape: a comment explaining
*why a design is what it is*, citing the real study that motivated it. `gis/corridor-generator.ts`
is the clearest — *"141 hand-written polygons cannot be reviewed"* — which is an argument about the
generator's existence, not a constant it uses. Its `count` is a parameter with a docblock saying
whose 141 it is.

Deleting these would make the code worse and the history unrecoverable. CLAUDE.md rule 3 forbids the
pilot's data in reusable code; it does not forbid saying which real study a decision came from.

### One thing that is not a leak but is worth saying

`ROAD_EIA_SOCIAL_PROFILE.label` and `.description` are Spanish strings in `@eia/domain`, which
ADR-029 otherwise moved out of the domain. They reach no screen: the Portfolio renders
`vocabulary.profile.road_eia_social` from the catalogue, and `profileLabel()` — the function that
would return the domain's string — has **no caller**. Recorded as TD-112 rather than churned.

## 3. What study #2 proved, which a search cannot

A grep finds a constant. It cannot find an *assumption* — a query that happens to work because only
one project exists. So the second half of this audit is `e2e/second-project.spec.ts`, which creates
a project through the Portfolio, prepares it in the intake, and then asserts that:

- every surface of the new project — Command Center, GIS, field, social, quality, documents,
  reports — shows **none** of the pilot's figures and never its name;
- the pilot is unchanged, and never shows the new project's name or programme;
- the breadcrumb and the switcher name the project in the URL, on both.

And underneath it, `packages/testing/test/rls/wave3-two-projects.integration.test.ts` asks the
question that scales past two: **is there any project-scoped table whose policy forgot the
project?** It enumerates every table in `app` carrying `project_id` and asserts FORCE RLS, a policy
naming `app.current_project_id()` (or a declared delegation chain that reaches one), and the
composite foreign key. A future table that forgets fails the moment its migration lands, rather
than the first time somebody writes a fixture for it.

## 4. What this audit did **not** do

- It did not touch fixtures, seeds or `docs/DEMO_ZAMORA.md`. The pilot's figures are historical
  facts of a real, concluded study and belong there.
- It did not remove the comments. A codebase that cannot say why it is shaped the way it is has
  traded one kind of debt for a worse one.
- It did not check the *demo data* for realism. That is `demo:doctor`'s job, and a different
  question.
