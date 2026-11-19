---
"@eia/field": patch
---

The tab bar's badge counts the same thing every other screen counts.

It read `sync_outbox` alone, so on the emulator the bar said *Sincronizar ahora (1)* on the same
screen whose chip said *2 por sincronizar*. It now calls `countPendingWork`, like *Mi trabajo*,
*Ajustes*, the Centro de sincronización and the sign-out refusal.

The automatic synchronisation on reconnect follows the same number, so a photograph whose upload
failed — which has no outbox row until its bytes are stored — is now something the device retries
on its own when signal returns.
