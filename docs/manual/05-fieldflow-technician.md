# 05 · FieldFlow for a technician

`/t/…/p/…/field`, signed in as `tecnico@demo.invalid`, **on a phone-sized viewport**. The screen is
designed for one hand outdoors, so review it at a phone width rather than a desktop one.

## My Work

The technician's own assignments and nobody else's: parcel code, position on the corridor, state,
and one obvious action per card.

## Capturing

1. Open an assignment → the parcel's context and the published questionnaire.
2. Starting the visit asks the browser for a location. If it is denied or unavailable, that outcome
   is **recorded as denied or unavailable** — never fabricated, and never a household's address:
   the point is the technician's own position at the time of the visit.
3. Answer, save as draft as often as you like, then submit.
4. After submission the response is **read-only**. There is no edit.

## The boundary to test

Type another technician's assignment URL. It answers **404**, not "denied": a distinguishable error
would confirm the row exists, which is precisely what somebody editing ids wants to learn.

A technician holds neither `field.read` nor `field.responses.read`. They cannot browse the
project's households, cannot open the coordinator's inbox, and cannot reach Social Intelligence.

## What the demo questionnaire collects

Nothing personal: no names, identity numbers, phone numbers, addresses, health or disability data,
individual income, or household coordinates. All answers are synthetic and labelled
`DEMO_SIMULATION`.
