# The Client Portal: what it would be, and what it must never be

> **Superseded in part, 7 September 2026.** The owner authorised a *published client view* inside
> the protected Preview environment, and it is built: see **ADR-027** and §8 below. §2 (what must
> never be exposed) and §3 (what can be shown) were followed to the letter and are still the
> contract; §5's three questions were answered; §7's recommendation to wait was overtaken by the
> demonstration this wave exists for. Related: ADR-009 (the portal is a separate security surface),
> ADR-027 (the publication and its allowlist), `docs/SECURITY.md`
> §11, `docs/FEATURES.md` (`client.portal`), Gate 1 decision D-019 (forecast publication),
> `docs/PRODUCT.md` §4.

## 1. Who the client is, and what they actually need

For this pilot the client is a **GAD** — a municipal or provincial government paying for a study and
answerable for it. Not an engineer, not a reviewer of the firm's internal work, and usually one or
two people who open the page occasionally and want an answer to three questions:

1. **¿Va en tiempo?** Where the study is against the plan, and whether the date still holds.
2. **¿Qué falta?** What remains, in terms a non-specialist recognises: field work, analysis,
   chapters.
3. **¿Puedo enseñar esto?** Something printable to take to a council session or to an authority.

They do **not** need — and should never be given — the internal working state: which parcel is in
verification today, what a household answered, which findings are open, what a specialist decided
and why.

## 2. What must never be exposed

This is the half of the decision that matters, and it is not a matter of styling a page carefully.
ADR-009 already draws the boundary the implementation must keep: **a separate route group, a
separate session, a separate database role, a separate context type, and reads only from a
published projection — never from the operational tables at request time.**

| Never | Why |
|---|---|
| Anything from the `pii` schema | it is the reason that schema exists |
| Individual survey answers, respondents, household coordinates | a client is not a party to what a household said |
| Parcel codes tied to a person, deeds, owner names, photographs of people | the delivered layers carried these and they were stripped before import; a portal must not become the place they reappear |
| Quality findings, specialist decisions and their justifications | an internal review record. Handing a client "the consultancy found a contradiction in its own study" without the specialist's resolution is neither fair nor useful |
| Raw AI classifications and confidence scores | proposals, not conclusions (ADR-019) |
| The audit log, the activity feed, technician names and workloads | staff supervision data |
| Internal notes, draft chapters, unpublished report versions | a draft is marked BORRADOR precisely because nobody has approved it |
| Anything with regime `DEMO_SIMULATION` | a client seeing simulated progress as their project's progress is the single worst failure this product could have |

## 3. What can be shown, and in what form

**Aggregate, published, and dated.** The rule is not "hide the sensitive columns"; it is that the
portal reads a *projection* that was explicitly published by someone with `portal.publish`, and that
the projection is built from an allowlist rather than filtered from a full record.

| Candidate | Form | From |
|---|---|---|
| Progress of the study | percentage and a short state per milestone | `Milestone` + project lifecycle |
| Field coverage | *N de 141 predios levantados* — a count against a published universe, never a map of who was visited | the current campaign's counts (ADR-026: **only** the current operation) |
| Consultation | assemblies held, participants registered | historical aggregates, already `HISTORICAL_OBSERVED` |
| The corridor | a static outline of the alignment and the areas of influence, no parcels | the generalised geometry the GIS surface already produces for drawing |
| The management plan | number of plans, programmes and measures, and the plans' titles — the *shape* of what will be delivered | `pgas_plan` counts, never the measure text unless the firm decides the chapter is public |
| Deliverables | which chapters exist, their state, and an approved PDF when one exists | `Deliverable` + portal exports |
| Contact and dates | who to ask, the target date | project record |

**The forecast is the special case.** D-019 already decided it: `client.portal.show_forecast` is
**false** by default; when a project turns it on, only an explicitly published `ForecastSnapshot`
enters the publication, with its provenance, the instant it was calculated, its assumptions and
wording that says it is a projection — and a `DEMO_SIMULATION` snapshot can never be published at
all, which the validator enforces rather than the reviewer remembering.

## 4. What already exists that would feed it

| Exists today | What it gives the portal |
|---|---|
| `client.portal` capability, entitled and toggleable | the module boundary and the 404 policy for a project that has not enabled it |
| `ClientPortalGrant` (modelled, not implemented) | client access as a **grant**, never a project role — internal permission resolution never sees a client row |
| `portal` schema and `eia_portal` role, reserved in migration 0000 | the separate database role; the schema and grants are still to be created (TD-005) |
| Faceted provenance on every value | the ability to refuse to publish anything whose regime is `DEMO_SIMULATION` |
| Milestones, metrics, campaign counts, PGAS counts | the substance of the three questions in §1 |
| The report generator's snapshot | a published deliverable that already carries a source for every figure |

## 5. The three decisions the owner has to make first

1. **Does the client see a number that moves, or a state that changes?** A live percentage invites
   "why did it go down this week"; a milestone state invites "when does the next one close". They
   are different products and the second is cheaper and calmer. *Recommendation: milestones, with
   one coverage figure.*
2. **Who publishes, and how often?** The portal is a *publication*, not a mirror. Somebody with
   `portal.publish` decides that this is the state the client may see. Weekly? At each milestone?
   *Recommendation: at each milestone, plus on demand — and the page shows the publication date, so
   nothing looks fresher than it is.*
3. **Does the client get the management plan?** It is the deliverable they paid for, and it is also
   the thing a competitor would most like. *Recommendation: titles and counts by default; the full
   chapter only through an approved deliverable.*

## 6. What building it would actually cost

Not a screen. The work is: the `portal` schema and its role and grants (TD-005), the publication
tables and the publish use-case, the allowlist projection with a denylist test asserting that no
forbidden concept can appear, a second authentication surface with its own cookie and context type,
and the isolation suite that proves a client session cannot reach an internal route or an
operational table. **The surface itself is the small part**, which is exactly why it should not be
started as "just a page".

## 7. Recommendation

**Do not start it in the next wave.** Two things should come first, and both make the portal better
when it arrives: a **second project** (which is what turns the profile mechanism from a design into
a fact, and would immediately show whether the portal's content is project-shaped or pilot-shaped),
and the **compliance review** (SECURITY.md §10a), because the portal is the surface where a
data-protection mistake reaches someone outside the firm.

When it is started, start with §3's table and the denylist test — not with the layout.

## 8. What was actually built (7 September 2026, ADR-027)

A **published client view**, not an external portal. The distinction is the whole of it.

| Built | Not built |
|---|---|
| `portal.client_publication`: an immutable, versioned, allowlisted snapshot per project | any external client identity, session or invitation |
| `Portal del cliente`, where the firm prepares, previews, publishes and reads the history | withdrawal of a publication (TD-077) |
| `/portal/:tenant/:project`, a standalone client page with its own chrome and a print stylesheet | grants for `eia_portal`, which still reads nothing (TD-005) |
| `portal.preview` beside `portal.publish`: a reviewer checks, a coordinator decides | milestones and deliverables, which have no model yet and render honest empty states |
| A hard refusal of `DEMO_SIMULATION`, and of live data that is not a safe aggregate | a forecast, which D-019 keeps off and the validator rejects outright |

§5's three questions, answered by what was built:

1. **A number that moves, or a state that changes?** Neither, yet — and deliberately. The first
   publication carries the concluded study's aggregates and no operational progress at all, because
   the only progress this environment has is simulated. *Seguimiento* says so in words.
2. **Who publishes, and how often?** A COORDINATOR, on demand, and the page shows the date. The
   cadence question is now Carlos's to answer (`docs/CONSULTANCY_FEEDBACK_TEMPLATE.md` §2).
3. **Does the client get the management plan?** Titles and counts — nine plans, twenty programmes,
   eighty-six measures — and not the measure text. Exactly the recommendation.

§7's recommendation — *do not start it in the next wave* — was overtaken by a decision to
demonstrate, not by a change of mind about the two things that should come first. A **second
project** and the **compliance review** are still what stand between this and a portal a real client
opens (TD-005, TD-078, SECURITY.md §10a).
