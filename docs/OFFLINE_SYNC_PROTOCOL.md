# The offline sync protocol

> The wire between EIA Field and EIA Studio. Schemas: `packages/field-sync-contract`. Server:
> `packages/application/src/field/{field-pack,sync}.ts` and `apps/web/app/api/field/*`. Decision
> record: **ADR-028**.

## 1. The invariant

> **The same command, sent any number of times, produces one result and one set of rows.**

Everything below is in service of that sentence. A retry is the ordinary case, not the exception:
a technician's connection returns for four seconds in a valley, the request is sent, the answer is
lost, and the device has no way to know which.

## 2. Three calls

| Route | Meaning |
|---|---|
| `POST /api/field/pack` | download my work: project, campaign, published questionnaire, my assignments, a validity window |
| `POST /api/field/sync` | here is what I captured (≤ 50 commands) |
| `POST /api/field/pull` | what changed for me |

Each resolves its caller through `resolveAccessContext` — the same function a workspace page uses.
The body may name a tenant and a project, and those are looked up **inside the caller's
memberships**; it may not name a user, and nothing on the server reads one. A tenant or project the
caller cannot see answers **404**, never 403, so the surface cannot be used to enumerate.

## 3. The Field Pack

Scoped to one technician. It carries the project's identity, the campaign, the **published**
`SurveyVersion` with its questions and options, and the caller's own assignments with the parcel
context needed to find a parcel — a code, a chainage, a side.

It never carries another technician's assignments, a respondent, a response, a coding, a finding, a
document, a geometry or a coordinate. That is asserted by
`packages/application/test/field-sync.integration.test.ts`, structurally (the parcel object has
exactly five keys) rather than by string search.

`openVisitId` and `instanceId` are handed to the device on purpose: a technician who reinstalls the
application, or syncs from a second device, must not start a second visit or a second response for
work the server already holds.

## 4. The command envelope

```ts
{
  commandId,          // generated once, at the moment of intent, never regenerated
  protocolVersion,    // refused if the server does not speak it
  deviceRevision,     // orders this device's own edits to one entity
  occurredAt,         // the device's clock — what the device believed, not the workflow's time
  appVersion,
  packSchemaVersion,
  type, payload
}
```

Four types: `visit.start`, `survey.upsert_draft`, `survey.submit`, `visit.finish`. Each is executed
by **the use-case the web form calls**, so a device cannot write a row a browser could not.

`deviceRevision` is a per-entity counter, not a vector clock: one assignment belongs to one
technician on one device, which is what makes a single counter sufficient.

## 5. Five outcomes

| Outcome | Meaning | Device |
|---|---|---|
| `applied` | the server did it now | done |
| `duplicate` | this exact command was already processed; the stored result is replayed | done |
| `superseded` | the intent is obsolete and the work is accounted for | **done** — stop retrying |
| `conflict` | the server will not do it and a person must look | stop; keep the local work |
| `rejected` | malformed or not permitted | stop; surface it |

`superseded` is the one that earns its place. A draft that arrives behind its own submit, or a
revision older than one already applied, can never succeed — and an outbox that retries it for ever
blocks every command behind it while the technician watches a count that never reaches zero.

## 6. Idempotency, concretely

`app.field_sync_receipt (tenant_id, project_id, user_id, command_id, command_type, outcome,
entity_kind, entity_id, device_revision, result, processed_at)`, unique on
`(tenant_id, project_id, command_id)`, FORCE RLS, write-once by grant **and** trigger, and scoped to
`user_id = app.current_user_id()` — a receipt names what one person's device did.

Processing one command:

1. look up the receipt → if present, replay it, relabelled `duplicate`;
2. check the conflicts (§7);
3. run the use-case;
4. record the receipt (`on conflict do nothing`, because two retries can legitimately race);
5. answer.

The receipt is written **after** the work, not in the same transaction, and that is a deliberate
trade: a use-case opens its own transaction, and a crash between the two leaves work applied and
unrecorded — which the retry resolves, because the use-case returns *the same* visit or response.
The reverse order would acknowledge work that never happened, so it is never used.

## 7. Conflicts, and what happens to the technician's work

| Case | Outcome | Local work |
|---|---|---|
| Assignment is no longer the caller's | `conflict: assignment_reassigned` | **kept**, marked *requiere revisión* |
| Assignment cancelled | `conflict: assignment_cancelled` | **kept** |
| Campaign closed | `conflict: campaign_closed` | **kept** |
| Questionnaire changed on the server | `conflict: survey_version_changed` | **kept**, and never reinterpreted |
| Draft arriving after its own submit | `superseded` | settled; the submitted answers stand |
| Older device revision after a newer one | `superseded` | settled; the newer answers stand |

Nothing in this table deletes anything on the device. An assignment the server stops sending is
**marked revoked**, never removed, because there may be a day of work under it.

## 8. Pull

Returns the caller's **current** assignment set plus the ids that are no longer theirs, rather than
a diff. The set is bounded by design — one technician, one campaign, twelve assignments in this
pilot — so a diff would buy nothing and would introduce the one failure an offline client cannot
recover from: a change that fell between two cursors and is never seen again.

The cursor stays in the protocol as an opaque token, so a future incremental pull can change what it
encodes without a version bump, and so the device can show *última sincronización*.

A successful pull renews the offline window on the session's own terms.

## 9. Ordering on the device

The outbox drains strictly in insertion order, and the batch stops at the first command that does
not settle. A submit that overtook its own `visit.start` would arrive naming a visit the server has
never issued; a draft that overtook a newer draft would be written backwards.

A command formed before its visit was acknowledged carries `visitId: null` and is **patched** with
the server's id before it is sent. The `commandId` is untouched by the patch, so patching can never
create a duplicate.

## 10. What the protocol deliberately does not do

- It does not synchronise rows, or anything generic. Four intents, four use-cases.
- It does not replicate a project offline. A technician's device holds a technician's work.
- It does not carry media. There is no media domain yet (TD-037).
- It does not let the device assert identity, a tenant it is not on, or a questionnaire version the
  campaign does not name.
