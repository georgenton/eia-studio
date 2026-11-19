---
"@eia/field": patch
"@eia/i18n": patch
---

The Sync Centre counts what the other three screens count.

Its chip read the command queue, so it said "Sin pendientes" while Mi trabajo said "2 por
sincronizar" and the sign-out refusal said "Hay 2 elemento(s) sin sincronizar" — three answers to
one question on one device. It now uses the same `countPendingWork`, and names separately what is
*not* a queued command: a photograph still on the phone, a response never sent, and an order the
server refused, which no amount of waiting will clear and which says so.
