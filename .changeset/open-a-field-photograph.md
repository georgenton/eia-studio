---
"@eia/application": patch
"@eia/domain": patch
"@eia/web": patch
"@eia/i18n": patch
---

A photograph of a visit can be opened.

The parcel workspace listed a photograph's kind, capture time, note and size and offered no way to
look at it — under a note saying that downloading one was a deliberate, recorded act. The note was
right about the design and wrong about the product.

`GET …/parcels/:code/media/:mediaId` answers 303 to a five-minute presigned GET and 404 to
everything else. The row is read inside the caller's own RLS transaction, so the row-level policy
decides: a technician reaches their own photographs, a coordinator holding `field.responses.read`
reaches the project's, and a GIS specialist reaches none — as a not-found rather than a denial,
because a distinguishable answer would confirm the photograph exists. The issuance is audited as
`field.media.download_issued` with the visit and the kind, never the filename, the key, the link,
the technician's note or the coordinate.

The table carries a link to the route, never a signed URL: the signature is minted when somebody
follows it, one at a time.
