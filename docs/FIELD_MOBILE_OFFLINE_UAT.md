# EIA Field — offline acceptance procedure

> The reproducible test that decides whether Wave 1 is done. Run it on a **real device or
> simulator** with a development build; Expo Go cannot do it, because Expo Go cannot encrypt the
> local database and the application refuses to open an unencrypted one.
>
> Related: `docs/FIELD_MOBILE_ARCHITECTURE.md`, `docs/OFFLINE_SYNC_PROTOCOL.md`, ADR-028.

## 0. What is being accepted, and whether it has been

> Sign in → download → aeroplane mode → **switch language** → capture with a photograph → restart →
> continue → submit locally → reconnect → **interrupt one upload** → retry → sync → verify in the
> web → **sync again → zero duplicates**.

The last step is the one that matters. Everything before it is setup.

### Status, stated rather than implied

| | |
|---|---|
| Procedure | **PREPARED** — written, reproducible, and expanded in Wave 3 to 23 steps |
| Executed on a physical handset | **NO** |
| Passed | **NO** — a procedure nobody has run has not passed |

This distinction is the whole point of this section. *Prepared* and *passed* are different claims,
and a wave report that blurs them is telling somebody eight studies can go to the field on the
strength of a document. No native build artefact exists (TD-082) and no handset has run this
(TD-096); `docs/FIELD_MOBILE_BUILDS.md` §4 is what has to happen first, and every step of it is an
owner action with a lead time.

## 1. Prepare

| | |
|---|---|
| Server | a running EIA Studio (`pnpm dev:web`) or the staging Preview |
| Database | migrated and seeded (`pnpm e2e:prepare`), with `DEMO_USER_PASSWORD` set in the environment |
| Campaign | an **ACTIVE** campaign whose `capture_channel` is `EIA_FIELD_MOBILE`, with assignments for the technician identity |
| Identity | `tecnico@demo.invalid` (project role `FIELD_TECHNICIAN`) |
| Device | Android or iOS **development build** — `pnpm --filter @eia/field prebuild` then `run:android` / `run:ios` |
| API URL | `EXPO_PUBLIC_API_URL` pointing at the server, reachable from the device (a LAN address, not `localhost`, on a physical handset) |

Record, before starting:

```sql
select count(*) from app.field_visit      where assignment_id = '<assignment>';
select count(*) from app.survey_instance  where assignment_id = '<assignment>';
select count(*) from app.survey_answer a join app.survey_instance si on si.id = a.instance_id
 where si.assignment_id = '<assignment>';
select count(*) from app.field_sync_receipt where user_id = '<technician>';
```

## 2. The procedure

Twenty-three steps. Steps 5–7 and 21 were added in Wave 3: the **display language**, because the
product became bilingual and an answer must be a code rather than a word (ADR-029); a
**photograph**, because a visit now carries evidence (ADR-032); and an **interrupted upload**,
because a rural corridor is where one happens.

| # | Step | What must be true |
|---|---|---|
| 1 | Open the application, sign in with a signal | *Mi trabajo* appears |
| 2 | Tap **Actualizar trabajo asignado** | The assigned parcels are listed, with chainage and side |
| 3 | Open `Ajustes` | *Trabajo descargado* shows a date within seven days |
| 4 | **Turn on aeroplane mode** | The header shows `Sin conexión` |
| 5 | In `Ajustes`, switch the language to **English** | Every label changes. **No answer, no code and no parcel identifier changes** |
| 6 | Return to *My work* and confirm the same assignments | The list is the same list; only its words moved |
| 7 | Switch back to **Español** | Everything returns. Nothing was re-saved and nothing was translated |
| 8 | Open a parcel → **Iniciar visita** | The location permission is asked once; deny it deliberately on one parcel |
| 9 | Take a photograph of the parcel (*Predio*) | A chip appears: *Pendiente de subida*. The camera opened, not the photo library |
| 10 | Fill the questionnaire; leave a required question empty | — |
| 11 | **Force-quit the application**, reopen it | The draft is still there, complete, with `Borrador en el dispositivo`; the photograph is still listed and still pending |
| 12 | Tap **Enviar en el dispositivo** | It **refuses** and names the missing required question |
| 13 | Answer it, tap **Enviar en el dispositivo** again | The row reads `Enviada en el dispositivo · pendiente de sincronización` — **not** `Sincronizada` |
| 14 | Open the ficha again | It is read-only, and says why |
| 15 | Open `Centro de sincronización` | Pending commands are listed with their types; **no answer content is shown**, and no photograph is previewed |
| 16 | Force-quit and reopen | The outbox is intact and the count is unchanged |
| 17 | Repeat steps 8–13 on a **second** parcel, with a photograph of the affectation | Two visits, two responses, two photographs, all pending |
| 18 | **Turn off aeroplane mode** | The header shows `Con conexión`; sync starts on its own, or press **Sincronizar ahora** |
| 19 | While the first photograph is uploading, **turn aeroplane mode back on** | The affected photograph returns to *Pendiente de subida* **with its file**. Nothing is lost |
| 20 | Turn aeroplane mode off and press **Sincronizar ahora** | The interrupted upload resumes; the count reaches zero |
| 21 | Confirm the device's own files | The files of acknowledged photographs are gone; any still pending are there. The camera roll never held any of them |
| 22 | In the web app, open *Trabajo de campo* as the coordinator | Both visits and both responses are there, with the same answers. The parcel's *Fotografías* tab lists two rows |
| 23 | **Press Sincronizar ahora again**, twice | Nothing changes anywhere |

Also verify, at step 22:

- the visit shows its location outcome — `captured` on one parcel, `denied` on the one refused at
  step 8. **No coordinate was invented**;
- reading the coordinator's screen in **English** shows the same answers: the codes did not move
  when the words did.

## 3. The assertion

Re-run the four counts from §1.

| | Expected |
|---|---|
| `field_visit` | **+1** per parcel visited — never +2 |
| `survey_instance` | **+1** per parcel submitted — never +2 |
| `survey_answer` | one row per answered question — unchanged by step 23 |
| `field_media` | **+1** per photograph taken — never +2, including the one whose upload was interrupted |
| `field_sync_receipt` | one row per **command**, and re-syncing adds none |

If any count moved on step 23, the wave is not done. The `field_media` row is the one the
interrupted upload of step 19 is about: a retry must not produce a second photograph of the same
moment.

Add the media count to the ones recorded in §1:

```sql
select count(*) from app.field_media where captured_by_user_id = '<technician>';
```

## 4. The conflict cases

Run each on a device that is offline and holding a draft, then reconnect.

| Set up on the server, while the device is offline | Expected on the device |
|---|---|
| Reassign the assignment to another technician | `requiere revisión`; **the draft is still there, complete** |
| Cancel the assignment | `requiere revisión`; the draft is still there |
| Close the campaign | `requiere revisión`; the draft is still there |
| Publish a new `SurveyVersion` and point the campaign at it | `requiere revisión`; the answers are **not** reinterpreted against the new questions |
| Let the pack's offline window expire while a draft is held (§5) | `Iniciar visita` is disabled for **new** work; everything captured is still there and still pending |

In every case: nothing on the device is deleted, and nothing on the server is written.

Run each case twice — once with the device in Spanish and once in English — and confirm the row
reaches the same state. A conflict that resolved differently depending on the display language would
mean the language had reached the state machine, which it must not.

## 5. The offline window

| Step | Expected |
|---|---|
| Set the device clock past the pack's `expiresAt`, with no connection | *Mi trabajo* says the downloaded work expired; **Iniciar visita** is disabled |
| Confirm the queue | Everything already captured is **still there** and still pending |
| Reconnect and sync | The queue drains; the window is renewed by the pull |

The limitation this exercises, and which no design removes: a device with no connectivity cannot
learn that an account was revoked. Revocation takes effect at the next server contact.

## 6. Sign-out

| Step | Expected |
|---|---|
| With pending commands, tap **Cerrar sesión** | It **refuses**, and says how many are pending |
| Sync, then sign out | Session, database key and database file are all gone; the next sign-in starts clean |

## 7. Photographs (Production V1 Wave 2, ADR-032)

**Nothing in this section has been run**, because no native build artefact exists (TD-082) and a
camera cannot run in a bundle nobody installed. It is written now so that the first person with a
handset has the procedure rather than inventing one, and it is recorded as TD-096. Its key steps are
folded into the 23-step sequence of §2; what remains here is the detail that sequence does not have
room for.

The property being accepted is the one that cannot be undone: **a photograph is never released from
the device before the server has acknowledged the row.**

| Step | Expected |
|---|---|
| In aeroplane mode, open an assignment and take three photographs (*Predio*, *Afectación*, *Acceso*) | Three chips, each *Pendiente de subida*. No error, no spinner that never ends: a photograph waiting for signal is safe and the screen says so |
| Deny the camera permission once, then take a photograph | The refusal is stated plainly and the visit continues. Nothing is captured and nothing is queued |
| Take a photograph **before** starting the visit | It is recorded and held: there is no server visit for it to belong to yet |
| Force-quit the application and reopen it | The three photographs are still listed, in the same states. The files are in the application's own directory, not the camera roll |
| Restore connectivity and synchronise | Each becomes *Subida*. `Fotografías` in the Parcel Workspace lists three rows for the visit |
| Synchronise **again** immediately | Still three rows. Not six: `localId` is what the server keys on |
| Turn connectivity off mid-upload (aeroplane mode during the sync) | The affected photograph returns to *Pendiente de subida* with its file. Nothing is lost, and the next sync continues |
| After a successful sync, inspect the application's documents directory | The files of acknowledged photographs are gone; any still pending are there |
| On a deployment with no bucket configured (TD-090) | The intent call answers 503 with a sentence; the photographs stay on the device and the visit is unaffected |

Two things to look for that are easy to miss:

- a photograph must **never** appear in the client view (`/portal/:tenant/:project`), and
- the `Fotografías` tab must show *whether* there is a technician position, never the coordinates.

## 8. What this procedure does not cover

Background synchronisation (not the correctness mechanism, and not built), a correction workflow
for a submitted response (a submitted response is immutable by design), and removing a photograph
declared by mistake (TD-097).
