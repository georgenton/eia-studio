# 10 · Demo walkthrough

One path through everything that exists today. It takes about fifteen minutes and uses three
identities, so **signing out is part of the walkthrough** (topbar → your name → _Cerrar sesión_).

All data is synthetic or reconstructed demo data. Nothing here is anybody's personal information.

## 1 · Coordinator — `coordinadora@demo.invalid`

1. Sign in. You land on the tenant; open **Puente del Amor**.
2. **Command Center.** Read the operational KPIs and the forecast. Open the provenance drawer on
   one figure and confirm it names a regime, an origin, transformations and a granularity.
   _Check:_ the forecast states its formula and its inputs, so you can reproduce it by hand.
3. **GIS.** Click a polygon; the table row selects. Click another row; the map follows. Read the
   layer-provenance legend — it names a reconstructed alignment and synthetic parcels, and there is
   deliberately no base map.
4. **A parcel.** Open one from the table. Resumen, Afectaciones and Visitas carry data; Instrumentos,
   Media and Calidad state plainly that they are waiting on a module.
5. **FieldFlow.** The campaign, its questionnaire version, progress counted from the tables, and
   workload per technician as counts. Open one submitted response and read its answers.
   _Check:_ there is no way to edit an answer. There is not meant to be.
6. **Social Intelligence → Tabulación.** Every question states its denominator in words, and the
   multi-choice one says its shares can exceed 100 %.
   _Check:_ the Respuestas abiertas tab offers you no run button. A coordinator watches; a
   specialist decides.
7. **Quality Gate.** Press _Ejecutar revisión_. Four findings appear — real inconsistencies in the
   concluded study's file. Open **QG-001**: two documents of the same file, 71 predios and 70, at
   equal weight, neither called the error. Press the button again: nothing duplicates.
   _Check:_ there is no decision form. A coordinator checks; a reviewer decides.
8. **Documents.** Ask the expediente _predios con afectación_. The answer is passages, each quoted
   with its document, version and page — and a line saying there is no narrative because no model is
   configured. Read the caveat under the results: this is lexical search, not semantic.
   _Check:_ ask something the corpus does not discuss. It says so and cites nothing.
9. Back in **Quality Gate → QG-001**: the evidence now links to the passage it was transcribed from.
   Follow the link — it lands on the document, at that passage. The finding was never rewritten.
10. **Reports.** Press _Generar versión_. Open it: every figure carries the source it came from, and
    the themes section says nothing has been validated yet — it will not count AI proposals.
    Download the .docx and open it: _BORRADOR_ on the first page and in every footer.
    _Check:_ generate again. A new version appears and the first one is still there, marked as an
    earlier version, still saying what it said.
11. Sign out.

## 2 · Field technician — `tecnico@demo.invalid`, at a phone width

1. Sign in. You land on **My Work**: your own assignments and nobody else's.
2. Open one, start the visit, answer, save a draft, submit. After submission it is read-only.
3. _Check:_ paste another technician's assignment URL. It answers **404** — not "denied", because a
   distinguishable error would confirm the row exists.
4. _Check:_ `/t/…/p/…/social` denies you. A technician holds no `field.responses.read`.
5. Sign out.

## 3 · Social specialist — `especialista@demo.invalid`

1. Sign in, open **Social Intelligence → Respuestas abiertas**.
2. Locally, start a classification run and drain the queue (`pnpm social:drain`); on staging today
   the tab reports that assisted coding is unavailable, because no model provider credential is
   configured (TD-049). **It does not substitute the test classifier**, and that is the point.
3. With proposals present: accept one, correct another. Open the accepted one again — the proposal
   is still there, unedited, beside your decision.
4. _Check:_ the validated distribution counts your labels only; the AI's distribution sits in its
   own panel with its own base.
5. _Check:_ the confidence figure says in visible text that it is not a calibrated probability, and
   the agreement figure says it is concordance rather than accuracy.
6. Sign out.

## 4 · Quality reviewer — `revisor@demo.invalid`

1. Sign in, open **Quality Gate → QG-003** (the consultation dates).
2. _Check:_ the submit button stays disabled until the justification is long enough. A token word is
   not a reason.
3. Dismiss it with a real reason. Reload: the decision, your name and your words are in the history.
4. _Check:_ _Marcar como resuelto_ is no longer offered — the state machine forbids it from
   `DISMISSED`, and the server refuses it too.
5. Reopen it with a different reason. **Both decisions are on the page.** The first was not edited.
6. Sign out.

## 5 · Tenant admin — `admin@demo.invalid`

1. Sign in. The Portfolio lists every project — names, state, progress.
2. _Check:_ open a project surface. You are **denied**. An `ADMIN` administers the tenant and needs
   an explicit project membership to read project data. That denial is the feature.

## What you will not find, and why

| Not there                         | Why                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------- |
| Documents, RAG assistant, Reports | ANNOUNCED, therefore disabled: their routes answer 404                           |
| Client Portal                     | a separate surface, not built                                                    |
| A role switcher                   | a role is a server-side membership; changing it means signing in as someone else |
| Offline field capture             | not built (TD-035); a campaign requiring it cannot be activated                  |
| Any real personal data            | forbidden before the compliance gate (SECURITY.md §10a)                          |
