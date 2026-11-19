---
"@eia/field": patch
---

Taking a photograph updates the count every screen reads, and the sign-out refusal with it.

The capture handler re-read only the parcel's own list, so the shared summary stayed as it was
until the next synchronisation. A device with nothing else pending could therefore take a
photograph and be allowed to sign out — which discards the local database and the file.
