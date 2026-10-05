---
"@eia/i18n": patch
"@eia/web": patch
---

A document that could not be read can be asked again, from its own page.

`requeueExtractionAction` and both languages' copy for it had existed since ADR-033, and **no
screen called either**. So a version in `FAILED` or `REQUIRES_OCR` was a dead end: the extraction
fix of 3 October 2026 reached staging and could not be exercised on a real document, because
nothing in the product could ask for one to be re-read.

The control appears for exactly those two states, and only with `documents.write`. Not for
`READY` — chunks are immutable and the use-case refuses it — and not for `QUEUED` or
`PROCESSING`, where the honest answer is to wait. Visibility is convenience; the action still
resolves surface access and the use-case still requires the capability and the permission.

One thing the e2e caught that a unit test could not: the outcome has to **outlive the control**.
A successful retry moves the version to a state that offers no retry, so a component mounted on
that condition refreshed itself out of existence and took its own confirmation with it.
