---
"@eia/domain": patch
"@eia/application": minor
"@eia/db": minor
"@eia/web": minor
---

A published photograph is a derivative with no EXIF, and the editorial upload door actually opens.

Three things, all of them things that were wrong rather than missing.

`uploadIntentInputSchema` listed three namespaces by hand and omitted `portal-editorial`, so a
namespace with a permission, a format allowlist and a key builder could not be uploaded into at
all. The schema is now derived from the catalogue, because the second hand-maintained copy is what
drifted.

A photograph published from the uploaded bytes publishes its EXIF, which is where and when it was
taken. Publishing now references a **derivative**: decoded, oriented, bounded and encoded again
with sharp, so metadata is absent because it was never written. The original stays private and a
page that points a photo at it is refused. `field-media` is untouched — a technician's photograph
is evidence and keeps what the camera wrote.

`/p/:tenant` lists a firm's published roads by querying the published rows alone, so a project
with no publication, a withdrawn one and a private one are absent rather than filtered out.
