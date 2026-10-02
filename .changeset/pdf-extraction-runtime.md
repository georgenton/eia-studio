---
"@eia/application": patch
"@eia/worker": patch
---

PDF extraction works in the published image, and CI asks the image rather than the workspace.

A valid PDF uploaded to staging produced `the file could not be read`, while every test here
passed. The cause was packaging in two layers, both proven against the published digest before
anything was changed: `pdfjs-dist@5.4.149` evaluates `new DOMMatrix()` at module scope and takes
that global from `@napi-rs/canvas`, which the image did not carry — so the import threw
`ReferenceError: DOMMatrix is not defined` before a byte was parsed; and once that package was
supplied, `getDocument` failed because esbuild had bundled `pdf.mjs` into a hashed chunk and left
`pdf.worker.mjs` behind in `node_modules`.

`pdfjs-dist` is now an external of the worker bundle, so pdf.js keeps its own runtime layout, and
both packages are declared explicitly rather than inherited as somebody else's optional
dependency. The image gains roughly 70 MB and a native binary (TD-123).

The regression test is the one that was missing: every build now runs `extractPdf` **inside the
image it just built** and fails the build if no text comes back.
