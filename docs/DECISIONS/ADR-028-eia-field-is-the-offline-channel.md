# ADR-028 — EIA Field is the offline capture channel, and it syncs commands rather than rows

- Status: Accepted
- Date: 16 September 2026
- Supersedes in part: ADR-018 §"what a second channel would look like" and
  `docs/FIELD_CAPTURE_ADAPTER_CONTRACT.md` as a **plan for production offline capture**. Both stay
  as history; neither is deleted.
- Related: ADR-004 (RLS), ADR-006 (survey versioning), ADR-010 (identity provider boundary),
  ADR-015 (domain/application layering), ADR-018 (offline capture is configuration),
  ADR-026 (a campaign is an operational snapshot), `docs/SECURITY.md`, `docs/TENANCY.md`.

## Context

Production V1 commits EIA Studio to eight rural-road projects with a go-live of 15 October 2026,
and the technicians who will use it work where there is no mobile data. Until now the product said
so honestly and did nothing about it: `field.surveys.offline_mode = required` refused to activate a
campaign, because the only capture channel was a web form that posts to a server (ADR-018, D-020).

The plan recorded at the time was that offline capture would arrive as an **adapter for an external
form product** — ODK, Kobo, XLSForm — with a mapping contract. That plan is superseded for
Production V1, and the reason is not preference. An external form product would hold the
questionnaire, the identities and the raw answers in somebody else's system; the versioned
questionnaire this product's whole data model rests on (ADR-006) would become a projection of theirs,
`field.responses.read` would stop being enforceable at the point of capture, and the hard part would
move from *collecting* to *reconciling* — which is the part that loses data.

## Decision

### 1. EIA Field: a first-party React Native application, and a real capture channel

`apps/field`, React Native + Expo + TypeScript, in the existing workspace. It is registered as
`EIA_FIELD_MOBILE` in `CAPTURE_CHANNELS` with `supportsOffline: true` — the **first** channel that
earns that flag — so a project whose policy is `offline_mode = required` can now run a campaign.

No fifteenth capability key. Offline capture remains configuration under `field.surveys`, exactly as
ADR-018 decided; what changed is that a channel now exists which satisfies the strict mode.

### 2. The device sends **domain commands**, never rows

A generic row synchroniser has to decide, on the device, what a write *means* — and the meaning is
what the domain owns: a submitted response is immutable, an assignment moves through a fixed
machine, a visit belongs to a technician. So the wire carries four intents — `visit.start`,
`survey.upsert_draft`, `survey.submit`, `visit.finish` — and the server executes **the same
use-cases the web form calls**. A device cannot produce a row a browser could not have produced, and
a rule added to the domain tomorrow applies to the mobile channel without anybody copying it.

### 3. Zero duplicates, built from three things that hold together

1. **The device names each intent once.** `commandId` is generated when the technician acts and
   never regenerated; a retry is the same id again.
2. **The use-cases were already idempotent by intent.** An open visit is returned rather than
   started twice; exactly one `survey_instance` exists per assignment and version, by unique
   constraint; a submitted response comes back as a result rather than as an error.
3. **`app.field_sync_receipt` remembers what each command id produced**, so a retry replays an
   answer instead of re-deciding it — which is what a draft retried *after* its own submit needs,
   because re-deciding it would raise `InstanceAlreadySubmitted` for ever and the queue would never
   drain.

The receipt is written **after** the work and not in the same transaction. That is deliberate and
worth stating rather than glossing: a use-case opens its own transaction, and the failure a shared
one would prevent — a crash between work and receipt — is already harmless because the use-case is
idempotent. The reverse order would *not* be harmless, so it is not used.

### 4. Five outcomes, and three of them mean "stop retrying"

`applied`, `duplicate`, `superseded`, `conflict`, `rejected`. The one that earns its place is
**`superseded`**: the intent is obsolete — a stale device revision, or a draft behind a submit — the
work is accounted for, and the device must stop. An outbox that retries everything for ever is not
resilient, it is stuck, and one impossible command at the head of the queue blocks every command
behind it while the technician watches a count that never reaches zero.

### 5. A conflict never deletes local work

An assignment reassigned or cancelled while the technician was offline, a campaign closed, a
questionnaire that moved: all of them mark the local row `CONFLICT / requiere revisión` and **keep
every answer**. The server refuses to reinterpret answers against a questionnaire they were not
given to, and the device refuses to throw away the only copy of a day's work because the plan
changed behind it.

### 6. Offline access is a window the server stamps, not a session the device extends

A disconnected device **cannot** learn that an account was suspended. Nothing fixes that. What the
product can do is make the window short, derived and visible: `min(session expiry, now + 7 days)`,
with a floor beneath which a pack is refused rather than handed over. Revocation takes effect at the
next server contact. When the window lapses the device stops offering *new* capture and **keeps
everything already captured**, which still syncs.

### 7. Two ids per entity, and the server's is the authority

A local row has a device-generated `id` from the moment it exists — offline, with no server in
sight — and gains a `server_id` when a command is acknowledged. Collapsing them would mean either
letting a client choose primary keys or having nothing to key local rows by until the network
returns; the first is a security decision nobody made, the second loses drafts on restart.

### 8. The bundle may not contain the server

`@eia/domain` is pure in ADR-015's sense but not *bundle-safe*: `documents/chunking.ts` imports
`node:crypto`. So the mobile application imports `@eia/domain/mobile`, a narrow entry point whose
import graph is walked by a test and must reach no `node:` builtin, plus
`@eia/field-sync-contract` — a zod-only package both sides share. No driver, no ORM, no application
layer, and no secret: the application authenticates by a session the technician creates.

## Consequences

- `field_capture_channel` gains a value (migration 0031) and `app.field_sync_receipt` is a new
  table with FORCE RLS, its own user-scoped predicate and write-once semantics (0032, 0033).
- Three HTTP routes exist (`/api/field/pack`, `/sync`, `/pull`) — the first non-browser entry
  points in the product. Each resolves its caller through `resolveAccessContext`, the same function
  a page uses; there is no service token and no device credential.
- Better Auth gains one trusted origin, `eiafield://`, as an exact literal. No wildcard.
- The pull returns the technician's **whole** assignment set rather than a diff, because the set is
  bounded by design (twelve in this pilot) and a diff would add the one failure an offline client
  cannot recover from: a change that fell between two cursors.
- Media is **not** part of this wave. There is no `Media` table, no storage adapter and no
  credential (TD-037); shipping a camera button that stores photographs the product cannot upload
  would be the dishonest half of a feature.
- Background sync is not the correctness mechanism and is not implemented. The guaranteed pathways
  are app launch, connectivity returning while the app is open, and the explicit button.
