---
"@eia/domain": minor
"@eia/web": minor
"@eia/db": patch
---

A campaign is an operational snapshot: close what ran, open what is intended.

A fixture revision moved the demonstration campaign's parcels along the corridor. The seeder fills
gaps and never re-does work — an assignment may carry an immutable submitted response — so it added
the ten new targets **beside** the twelve already there, and a twelve-parcel operation silently
became a twenty-two-parcel one that never happened.

Deleting the extras was not the repair. Two of them had been visited and answered, so deletion could
only ever be partial, and it would rewrite the record of an operation that ran so a newer plan
appeared to have been the plan all along.

**The rule (ADR-026): a campaign with field history is never rewritten to adopt a changed target
universe.** Changed semantics open a new campaign; the one that ran is closed, keeps every
assignment, visit and response it ever had, and is labelled *Operativo anterior* on screen.

- `assertCampaignClosable` (domain) and `closeCampaign` (application, `field.campaigns.manage`,
  audited) are the transition. A `DRAFT` cannot be closed: nothing happened under it.
- The demo fixture identifies its campaign by a declared **key** rather than by its Spanish display
  name, and a changed key is a different campaign.
- `resolveCurrentCampaign` is the one definition of *now*, consulted by the Command Center's field
  panel, by Social Intelligence — versions, tabulation, coding queue, workflow metrics,
  distributions — and by the report snapshot, which names the operation it counted. Two campaigns
  on one published questionnaire version no longer share a denominator.
- FieldFlow labels them *Operativo actual* and *Operativo anterior*, and says of a closed one that
  it is kept whole and excluded from today's figures.

The 119 historical socioeconomic surveys are a `HISTORICAL_OBSERVED` metric, not rows in these
tables; no campaign scope reaches them.
