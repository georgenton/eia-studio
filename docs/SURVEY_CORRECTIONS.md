# Correcting a submitted response

> What happens when an answer is wrong, and why nothing is ever edited. Related: ADR-038 (the
> decision), ADR-006 and CLAUDE.md rule 9 (answers are immutable), ADR-022 (a report version is
> frozen), ADR-028 (the offline device), `docs/OFFLINE_SYNC_PROTOCOL.md`, `docs/TENANCY.md` §3.1,
> `docs/SECURITY.md` §10b.

## 0. The rule, in one sentence

**A submitted response is never edited. A correction is a new response, captured in the ordinary
way, and an explicit relation says which response it replaces.**

History keeps both. Current analytics count exactly one.

```
ENVÍO ORIGINAL  (submitted, immutable)
      │
      ├── corrección solicitada          ← nothing changes yet
      │
      ▼
NUEVA CAPTURA   (submitted, immutable)   ← now this is the effective response
      │
      └── the original is still there, marked «Sustituida»
```

## 1. What is *not* possible, at any layer

| | |
|---|---|
| `UPDATE app.survey_instance` on a submitted row | refused by trigger (`survey_instance_submitted`, migration 0014) |
| `UPDATE`/`DELETE` on its answers | refused by trigger (`survey_answer_frozen`) |
| reopening a submitted response from the web form | the surface offers no such action, and the use-case has no path to one |
| reopening it from the device | same; the local survey state `SYNCED` is terminal |
| deleting a correction | `REVOKE DELETE` **and** a trigger |

Nothing in this document is a workaround for those. It is the workflow they were waiting for.

## 2. The model

```
survey_instance (original, SUBMITTED)
      ▲
      │ original_instance_id
survey_correction ── correction_assignment_id ──► field_assignment (corrects_assignment_id)
      │                                                    │
      │ correcting_instance_id                             │ the technician captures here
      ▼                                                    ▼
survey_instance (correction, SUBMITTED) ◄───────────────────
```

**A correction is a new assignment**, in the **same campaign** and on the **same parcel**. Three
reasons, all of them constraints rather than preferences:

1. `survey_instance` is unique on `(tenant, assignment, version)` — the invariant that makes a
   retried offline submit a no-op instead of a second household;
2. tabulation is scoped by campaign, so a correction outside it would fall out of the count it
   exists to fix;
3. who was originally assigned and who performed the correction stay two rows, so historical
   attribution is never overwritten.

The correcting response answers the **same `SurveyVersion`**. A questionnaire change is a different
workflow (ADR-037) and must not silently reinterpret old answers.

## 3. The lifecycle

| State | Meaning | What it changes |
|---|---|---|
| `REQUESTED` | somebody asked; a revisit exists | **nothing.** The original is still effective |
| `APPLIED` | a technician captured it and submitted | the new response becomes effective |
| `CANCELLED` | the request was withdrawn | nothing; the original was effective throughout |

There is no `IN_PROGRESS` — the correction's own assignment and visit already say that — and no
`SUBMITTED` beside `APPLIED`, because there is no approval step between capturing a correction and
it taking effect. **Submitting is applying**, in the same transaction.

A cancelled correction leaves the response correctable again. An applied one does not: the next
correction applies to the response that is now effective.

## 4. The effective response

One rule, in one place: **`app.effective_survey_instance`**, a view.

```
start at every submitted response that is nobody's correction
follow APPLIED corrections
the last one reached is the effective response
```

A `REQUESTED` correction is not followed. A `CANCELLED` one never was. Wall-clock time decides
nothing: the chain is an explicit relation, so two corrections recorded in the same millisecond
still have exactly one order.

Everything joins it — social tabulation, the numeric summary, validated themes, field progress, the
report snapshot — through `EFFECTIVE_INSTANCE_JOIN` / `IS_EFFECTIVE_INSTANCE` in
`packages/application/src/field/corrections.ts`, and **nothing writes its own predicate**. An
integration test walks the application source and fails if a second implementation appears, because
`where superseded = false` in six modules is six chances to disagree, and the disagreement would be
silent.

The view is `security_invoker = true`, asserted by a test: otherwise it would run as its owner and
return rows the caller's policies refuse.

`resolveEffectiveInstance` in `@eia/domain` is the same rule in TypeScript, and an integration test
asserts the two agree.

## 5. What the analytics show

Original `tenure_category = owner_occupier`, corrected to `tenant`:

| | |
|---|---|
| current tally | `tenant` = 1, `owner_occupier` = **0** (no row: the tabulation counts what was answered and manufactures no zero) |
| denominator | **1**, not 2 |
| submitted responses in the database | **2**, both whole |
| after a second correction | still one effective response, denominator still 1 |

Numeric questions behave the same way: original `household_size = 3` corrected to `5` gives a
summary of 5 alone. The 3 is still stored, on a response nothing current reads.

**Open text and social coding.** `ai_classification` and `human_review` point at a
`survey_answer`, which belongs to an instance. When a response is superseded, its codings stop
contributing to the validated-theme distribution because the distribution reads effective responses
— the codings themselves are untouched and stay readable. A corrected open answer that nobody has
coded yet therefore shows as *not yet coded*, which is true: **the previous answer's coding is never
reused for the new one.** It was a specialist's statement about words that are no longer the
response.

## 6. Reports and the portal

**A report version is a frozen snapshot** (ADR-022). A version generated before a correction keeps
every figure it had, byte for byte; the next version uses the corrected response. Both are tested.

**The client portal is unaffected.** `portal.client_publication` is an immutable, allowlisted,
composed snapshot that reads no survey response (ADR-027), so it reads no correction. A publication
made before a correction keeps every word. This is asserted rather than assumed.

## 7. Progress

A correction assignment is **not a parcel**. Campaign progress counts the parcels the campaign set
out to survey, so:

- the four assignment-state counts exclude correction assignments;
- `submitted` counts **effective** responses, so a corrected parcel is still one answered parcel;
- open corrections are a **separate count** beside them — *«2 correcciones pendientes»*.

Counting a revisit as a parcel would turn 141 into 142 and move a percentage for a reason nobody
reading it could see.

## 8. Who may do what

| Act | Permission | Roles |
|---|---|---|
| read a response and its lineage | `field.responses.read` | COORDINATOR, SOCIAL_SPECIALIST, REVIEWER |
| request a correction, or cancel one | `field.corrections.request` | COORDINATOR, SOCIAL_SPECIALIST |
| capture it | `field.capture`, on their own assignment | FIELD_TECHNICIAN, COORDINATOR |

Not `field.capture` for requesting: somebody who could decide their own work was wrong and quietly
replace it is the failure invariant 9 exists to prevent. `PROJECT_DATA_MANAGER` gains nothing — a
correction names a household's response, and that role reads none (ADR-030).

A technician sees the correction rows for **their own** revisit and no other, by policy.

## 9. On the device

The technician gets a work item, not a reopened form. The Field Pack's assignment carries:

```
correction: { correctsAssignmentId, reason, requestedAt }
```

and **no previous answer**. A device that would otherwise never hold another visit's responses does
not start holding them because a figure was wrong (SECURITY.md §10e); the reason is what tells a
technician which question to re-ask.

Offline behaviour is identical to ordinary capture, because a correction assignment *is* an
assignment: download → airplane mode → draft → submit locally → sync. A retried submit produces one
correcting response and applies the correction once.

`FIELD_SYNC_PROTOCOL_VERSION` is **3** as of ADR-038: `packAssignmentSchema` is `.strict()`, so a
new field breaks an older device's parse.

## 10. The words

Spanish and English, and one word that appears in neither.

| ES | EN |
|---|---|
| Solicitar corrección | Request correction |
| Corrección solicitada | Correction requested |
| Revisita de corrección | Correction revisit |
| Historial de la respuesta | Response history |
| Envío original | Original submission |
| Corrección {n} | Correction {n} |
| **Vigente para análisis** | **Current for analysis** |
| **Sustituida** | **Superseded** |

Never *editar respuesta enviada*, never *eliminar*. Nothing is edited and nothing is deleted; what
changes is which response the analysis currently means.

## 11. What is not built

- **No approval step.** A correction takes effect when it is captured. Inventing a review state for
  a review nobody performs is the same fiction as a report status nobody sets (TD-060).
- **No correction of a `HumanReview`** (TD-041). A coding of a superseded answer stops contributing
  because the analytics read the effective response; re-reviewing a coding is a separate gap.
- **No technician-initiated correction**, and no editing a correction request after it is made: the
  reason, the response and who asked are fixed at the moment of asking, by trigger.
- **No merging or forking of lineages.** A lineage is a line, by constraint.
