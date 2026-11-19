---
"@eia/application": patch
---

A remembered answer is replayed as itself: a refusal stays a refusal on the retry.

`processOne` and `processDelivery` relabelled **every** remembered receipt `duplicate`. That word
is on the device's `SETTLED` list, so a settled `media.declare` runs `acknowledgeMedia` and the
next sweep deletes the photograph's local file. A refusal whose response was lost in transit
therefore came back as a confirmation, and the device threw away the only copy of a photograph the
server had never stored. Only an `applied` becomes `duplicate` now.

And a photograph is admitted to a closed visit on **two of this server's own timestamps** — the
upload intent was issued before the visit was completed — rather than on the hour the phone
believed it was. `capturedAt` is the device's clock, declared by the same person the rule
constrains; it is worth recording and worthless as proof.
