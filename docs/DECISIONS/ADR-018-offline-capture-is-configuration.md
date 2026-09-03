# ADR-018 — Offline field capture is project configuration, not a capability

- Status: Accepted (Slice 3, closes Gate 1 decision D-020)
- Date: 2026-09-02
- Related: ADR-002 (capability resolution), ADR-003 (project profiles), FEATURES.md §1 and §2,
  PRODUCT.md §6, docs/FIELD_CAPTURE_ADAPTER_CONTRACT.md

## Context

The phase brief proposed a fifteenth capability key, `field.offline_sync`. Gate 1 declined to add
it and left the question open (D-020): is offline field capture a **capability** — does this
functionality exist here — or a **configuration** — how does enabled functionality behave? The
decision was deferred to the Field slice, which is this one, because until something actually
captured a survey the question could only be answered in the abstract.

Three things made the answer clear once FieldFlow existed.

**A project with offline disabled still has FieldFlow.** Same rail item, same routes, same
campaign, assignment, visit and questionnaire surfaces. What changes is the *channel* it may
capture through. FEATURES.md §1 draws exactly this line: a capability protects navigation, routes,
server actions and jobs; a configuration governs behaviour inside a capability that is already
enabled. Offline capture never removes a surface.

**A capability would have hidden a surface the project can plainly use.** Capability resolution is
a conjunction, and a route whose capability is false answers 404 (ADR-016). `field.offline_sync`
resolving false would therefore have to *not* hide anything — a capability key that gates no
route, no action and no job, which is a configuration wearing a capability's clothes.

**The catalogue is a contract.** PRODUCT.md §6 and FEATURES.md §2 fix fourteen approved keys, each
with surfaces, dependencies and enforcement points. Adding a fifteenth to express a behavioural
switch would set the precedent that any behaviour worth a toggle earns a key, which is how a
catalogue stops meaning anything.

## Decision

**Offline capture is the project configuration key `field.surveys.offline_mode`**, under the
existing `field.surveys` capability. The catalogue stays at fourteen keys. `field.offline_sync` is
not created, now or later, and a future offline implementation does not need it.

```
field.surveys.offline_mode : "disabled" | "optional" | "required"     default "disabled"
```

| Mode | Meaning | Online-only channel |
|---|---|---|
| `disabled` | The project captures online. | allowed |
| `optional` | Online capture remains valid; a channel with offline support may be used where one is configured. | allowed |
| `required` | A campaign may not be activated on a channel that does not declare offline support. | **refused** |

A second, deliberately small concept carries the other half: a campaign records its **capture
channel**, and each channel's descriptor states whether it supports offline capture.

```
CAPTURE_CHANNELS = ["NATIVE_WEB"]        NATIVE_WEB.supportsOffline = false
```

The rule that joins them is one function, called at campaign activation:

```
required ∧ ¬channel.supportsOffline  →  OfflineCaptureUnsupported
```

## Consequences

**`required` + `NATIVE_WEB` fails, and that is the point.** This slice has no service worker, no
IndexedDB answer store and no sync protocol. The browser form posts to the server. A project whose
policy genuinely requires offline capture therefore cannot run a campaign on this channel, and is
told so **at activation**, in a sentence naming the setting and the channel — not in a valley with
no signal after a technician has spent a day filling forms that were never going to arrive. The
product does not pretend to a capability it does not have.

**The failure is a domain error, not a UI check.** `assertCampaignActivatable` runs inside the
activation use-case, so it holds for a server action, a future API and a job alike. The campaign
row records `offline_mode_at_activation`, so the policy in force when technicians were sent out is
recoverable afterwards.

**Adding offline later changes this list, not this model.** An ODK/Kobo/XLSForm adapter, or a
first-party offline client, becomes a second entry in `CAPTURE_CHANNELS` with
`supportsOffline: true` and an adapter package. Campaigns, assignments, visits, versions and
answers are unchanged; `required` starts succeeding for projects that choose that channel. The
boundary such an adapter must respect is written down in
`docs/FIELD_CAPTURE_ADAPTER_CONTRACT.md`, deliberately *before* anyone builds one.

**What was rejected**, and why:

- **A fifteenth capability key.** Reasons above. It would also have needed a dependency edge, an
  entry in the enforcement registry and a navigation presentation, none of which it could use.
- **Building a sync engine in this slice.** Offline sync is conflict resolution, device identity,
  queue durability, partial submission and clock skew — a slice of its own. Shipping half of it
  behind a switch would be worse than not having it, because the switch would read as a promise.
- **Letting the UI decide.** Hiding the activation button for `required` projects would leave the
  server accepting the activation, which is precisely the "hiding is not authorization" mistake
  the architecture forbids for capabilities and which is no better for behaviour.

## Verification

- `packages/domain/test/field.test.ts` — the three modes, the channel descriptor, and that
  `required` + `NATIVE_WEB` throws `OfflineCaptureUnsupported` with the setting named.
- `assertCampaignActivatable` covers the same rule at the point of activation.
- The catalogue test in `packages/domain/test/capabilities.test.ts` still asserts exactly fourteen
  keys, so a future `field.offline_sync` cannot be added quietly.
- The coordinator surface states the channel's offline support in words
  (`e2e/field-coordinator.spec.ts`), and asserts the screen never claims offline is available.
