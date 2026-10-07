---
"@eia/domain": patch
"@eia/i18n": minor
"@eia/application": minor
"@eia/web": minor
"@eia/worker": minor
---

The editorial CMS is usable from the browser, and the published image can actually publish a photograph.

The surface gained the acts that were missing and lost the ones that were wrong. A tenant
administrator names the firm and the engagement (`portal.profile.manage`, held by OWNER and ADMIN
and deliberately not by a project editor: a person who writes one road's page must not rename the
organisation). An editor uploads a photograph, a PDF and a deck per section, and each of the three
fields now says which kind it takes — they were three identical rows distinguishable only by their
order. A successful upload clears the file input **both ways**, because the element keeps its own
value and a browser otherwise still showed the previous filename under a form that no longer held
it. A team member with no portrait gets the whole row rather than the 96px column reserved for a
photograph they do not have.

And the artefact was asked whether it can do any of this. It could not: the Next standalone trace
carried `sharp` into the image with the right platform binary and nothing linked it where a process
resolves, so `import("sharp")` failed from `/app`, from the web tree and from the worker bundle
alike — the pdf.js packaging defect again, with a worse invitation, since a derivative that cannot
be built tempts somebody to serve the original with its GPS in it. The Dockerfile links it and
asserts the import at build time, and `apps/worker/dist/image-smoke.js` ships in the image so CI
proves, before a digest exists, that a derivative comes out carrying no EXIF.
