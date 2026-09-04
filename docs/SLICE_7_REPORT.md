# Slice 7 — Assisted report generation

> What was built on `feat/slice-7-report-generation`, what was deliberately left out, and every
> place the implementation departs from the approved architecture. Companion to
> `docs/SLICE_1_REPORT.md` … `docs/SLICE_6_REPORT.md`.

## 1. The journey this slice delivers

A social specialist opens Reports. The project has no chapter yet, so the surface says what the
generator would read: the submitted responses, the validated codings, the decided findings, the
cited documents. They generate.

Back comes **v1** of the social chapter: five sections, each fact carrying the source it came from —
a deterministic count with its method in words, a theme count with the number of validated codings
behind it, a finding with the decision a reviewer took, a document passage with its version and
page. Nothing on the page is a model's opinion, because no model is configured here (TD-049), and
the chapter is complete without one.

They download the .docx. It says **BORRADOR — NO ES UN ENTREGABLE APROBADO** on the first page and
in every footer, lists the regimes of the data it rests on, and prints the source under every
figure.

A specialist validates two more codings and regenerates. **v2** appears; **v1** still says exactly
what it said, because a chapter is a thing that was produced on a date.

## 2. The one thing this layer must not do

A generated chapter is the first artefact of this product that leaves it looking like a consultancy
deliverable. The failure worth preventing is not a clumsy sentence: it is **a plausible number in a
paragraph nobody checked, because the numbers around it were right**.

Three rules make that impossible rather than unlikely.

- **Compute first, write second.** The snapshot is built from the database, checked, and stored. The
  prose is generated *from the snapshot*, never from the database. A generator that cannot see the
  data cannot invent a figure it never received.
- **A paragraph may state only figures its section computed.** `assertNarrativeGrounded` compares
  the digit sequences in the generated text against the digit sequences the section holds; an
  unmatched one fails the whole generation. Not a warning, not a redaction — a refusal, because a
  half-accepted paragraph is a sourced-looking sentence.
- **A fact cannot exist without a source.** Not "should have": the type has no shape for a fact
  without one, and `assertSnapshotHonest` runs before anything is written.

## 3. The snapshot is the deliverable (ADR-022)

The stored artefact is a validated JSON snapshot — five sections of facts, each with a typed source
of one of five kinds. Prose is optional and is a rendering of it.

That ordering is the whole decision. It means:

- a version generated with no provider configured is a **complete** report draft, not a degraded one;
- the .docx, the screen and any future renderer read the same stored substance;
- `snapshot_digest` identifies content rather than the moment of computation, so regenerating
  unchanged data is visibly a no-change ("los datos no han cambiado desde la versión anterior") instead of silently
  producing a different-looking chapter.

## 4. What the chapter counts, and what it refuses to count

| Section | Reads | Never reads |
|---|---|---|
| Universo y cobertura | submitted survey instances, campaign totals | drafts, unsynced work |
| Resultados de las preguntas cerradas | deterministic tabulation with its declared denominator | anything a model produced |
| Temas validados de las respuestas abiertas | `human_review` — validated codings only | `ai_classification`; a proposal is never a finding |
| Revisión de calidad del expediente | findings a reviewer **decided**, with the decision | open findings, and any compliance conclusion |
| Fuentes y procedencia | cited document versions and passages, with their provenance facets | uncited documents |

The refusal is enforced, not documented: a theme fact claiming a count from **zero** validated
codings throws `report_fact_without_validation`. The honest empty case — "—" with zero reviews — is
accepted, because a chapter that says nothing about a theme nobody coded is correct.

Likewise regimes: every provenance-sourced fact's regime must appear in the snapshot's declared
`regimes`, or `report_regime_undeclared` refuses the whole chapter. A chapter built partly on
simulated data says so at the top and on the first page of the .docx.

## 5. Versions are written once

A `ReportVersion`, its sections and its sources are insert-only for the runtime role: `REVOKE
UPDATE, DELETE` **and** BEFORE UPDATE/DELETE triggers, so even the owning role cannot quietly amend
one. This is the third time the product has needed exactly this shape — `human_review`,
`specialist_review`, now `report_version` — and it is written the same way each time.

The REVOKE is load-bearing rather than decorative: migration 0002's `ALTER DEFAULT PRIVILEGES`
grants full DML on every new `app` table, so a table intended as append-only that only *adds* a
GRANT is silently mutable. Slice 5 found that the hard way; Slice 7 wrote the REVOKE first and the
isolation test asserts an error rather than a successful no-op.

## 6. What was built

| Layer | Files |
|---|---|
| Domain | `packages/domain/src/reports/{snapshot,narrative}.ts` — the snapshot schema, the five source kinds, `assertSnapshotHonest`, `snapshotDigest`, `assertNarrativeGrounded`, `applyNarratives`, `nextReportVersionLabel` |
| Database | migration `0022` (4 tables, 1 enum), `0023` (grants + REVOKE, RLS, immutability triggers, uniqueness) — forward only, additive |
| Application | `packages/application/src/reports/{snapshot,generate,docx,read-models}.ts` |
| Web | `app/t/[tenant]/p/[project]/reports/{page.tsx,[version]/page.tsx,[version]/docx/route.ts}`, `components/reports/*`, `lib/report-actions.ts` |
| Capabilities | `reports.social_generator` moved from ANNOUNCED to AVAILABLE — the last one; the rail now has no placeholder row |

## 7. Verification

| Suite | Result |
|---|---|
| Unit and domain | **283 passed** (+18) |
| Integration (Testcontainers, RLS) | **350 passed** (+30: 12 isolation, 18 application) |
| End to end (Playwright) | **141 passed** (+11), nothing skipped |
| Accessibility (axe) | the empty surface and a generated version, no serious or critical violations |
| Staging (non-destructive) | **90 passed** (+9); migrations 22 → 24; the baseline diff before and after the run shows only the migration count — no row added, changed or removed |
| Lint, format, typecheck, build | clean |

**CI calls no model.** The narrative generator is selected by the same no-default rule as the Social
classifier (`resolveAiAdapterAvailability`); with nothing configured the state is `NOT_CONFIGURED`
and every version is generated without prose — which is a complete version.

## 8. Deviations

- **No approval workflow** (TD-060). One status, `DRAFT`. `deliverables.approve` exists as a
  permission and nothing consumes it. A button that said "approve" without the decision behind it
  would be worse than none.
- **The grounding check is arithmetic, not semantic** (TD-061). It catches the invented figure, not
  the wrong sentence.
- **One chapter shape** (TD-062). Five fixed sections; `generated_report.kind` is the extension point.
- **The .docx is rendered per download** (TD-063), because it is a deterministic function of an
  immutable snapshot and a stored copy could drift from the versioned one.
- **Three e2e assertions were updated, not loosened.** `authorization.spec.ts` and `journey.spec.ts`
  asserted that Reports was ANNOUNCED and therefore 404; it now ships, so they assert the successor
  facts — the extensions still have no route, the probe endpoint still refuses a capability that is
  not effective, and the rail's placeholder row is gone. One integration assertion in
  `tenancy.integration.test.ts` changed for the same reason.
- **The demo seeder gained one line.** `report_version.provenance_id` joined the cleanup's
  `NOT EXISTS` list; omitting it fails a re-seed on a foreign key, which is the loud version of the
  failure the list exists to prevent.

## 9. Debt this slice records

TD-060 (no approval workflow), TD-061 (grounding is arithmetic), TD-062 (one chapter shape),
TD-063 (the .docx is not stored).
