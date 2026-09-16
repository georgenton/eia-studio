# EIA Field — offline acceptance procedure

> The reproducible test that decides whether Wave 1 is done. Run it on a **real device or
> simulator** with a development build; Expo Go cannot do it, because Expo Go cannot encrypt the
> local database and the application refuses to open an unencrypted one.
>
> Related: `docs/FIELD_MOBILE_ARCHITECTURE.md`, `docs/OFFLINE_SYNC_PROTOCOL.md`, ADR-028.

## 0. What is being accepted

> Sign in → download → aeroplane mode → capture → restart → continue → submit locally → reconnect →
> sync → verify in the web → **sync again → zero duplicates**.

The last step is the one that matters. Everything before it is setup.

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

| # | Step | What must be true |
|---|---|---|
| 1 | Open the application, sign in with a signal | *Mi trabajo* appears |
| 2 | Tap **Actualizar trabajo asignado** | The assigned parcels are listed, with chainage and side |
| 3 | Open `Ajustes` | *Trabajo descargado* shows a date within seven days |
| 4 | **Turn on aeroplane mode** | The header shows `Sin conexión` |
| 5 | Open a parcel → **Iniciar visita** | The location permission is asked once; deny it deliberately on one parcel |
| 6 | Fill the questionnaire; leave a required question empty | — |
| 7 | **Force-quit the application**, reopen it | The draft is still there, complete, with `Borrador en el dispositivo` |
| 8 | Tap **Enviar en el dispositivo** | It **refuses** and names the missing required question |
| 9 | Answer it, tap **Enviar en el dispositivo** again | The row reads `Enviada en el dispositivo · pendiente de sincronización` — **not** `Sincronizada` |
| 10 | Open the ficha again | It is read-only, and says why |
| 11 | Open `Centro de sincronización` | Pending commands are listed with their types; **no answer content is shown** |
| 12 | Force-quit and reopen | The outbox is intact and the count is unchanged |
| 13 | **Turn off aeroplane mode** | The header shows `Con conexión`; sync starts on its own, or press **Sincronizar ahora** |
| 14 | Wait for the count to reach zero | The row reads `Sincronizada` |
| 15 | In the web app, open *Trabajo de campo* as the coordinator | The visit and the submitted response are there, with the same answers |
| 16 | Open the parcel's *Visitas* tab | The visit shows its location outcome — `captured` on one parcel, `denied` on the one refused in step 5. **No coordinate was invented** |
| 17 | **Press Sincronizar ahora again**, twice | Nothing changes anywhere |

## 3. The assertion

Re-run the four counts from §1.

| | Expected |
|---|---|
| `field_visit` | **+1** per parcel visited — never +2 |
| `survey_instance` | **+1** per parcel submitted — never +2 |
| `survey_answer` | one row per answered question — unchanged by steps 17 |
| `field_sync_receipt` | one row per **command**, and re-syncing adds none |

If any count moved on step 17, the wave is not done.

## 4. The conflict cases

Run each on a device that is offline and holding a draft, then reconnect.

| Set up on the server, while the device is offline | Expected on the device |
|---|---|
| Reassign the assignment to another technician | `requiere revisión`; **the draft is still there, complete** |
| Cancel the assignment | `requiere revisión`; the draft is still there |
| Close the campaign | `requiere revisión`; the draft is still there |
| Publish a new `SurveyVersion` and point the campaign at it | `requiere revisión`; the answers are **not** reinterpreted against the new questions |

In every case: nothing on the device is deleted, and nothing on the server is written.

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

## 7. What this procedure does not cover

Media capture (not built, TD-037), background synchronisation (not the correctness mechanism, and
not built), and a correction workflow for a submitted response (a submitted response is immutable
by design).
