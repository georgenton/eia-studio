---
"@eia/web": patch
---

Self-host the three web fonts, so `next build` reaches no network.

`apps/web/app/layout.tsx` loaded Source Serif 4, Archivo and JetBrains Mono through
`next/font/google`, which downloads them from `fonts.gstatic.com` **while the build runs**. When the
build container cannot reach Google, Next warns, still emits the generated font CSS module, and the
build then fails resolving files it never fetched — `Module not found
[next]/internal/font/google/jetbrains_mono_23b75448.module.css`. That is the intermittent
`docker build` failure recorded during the pre-deploy wave as observed-but-not-reproduced; it
reproduced in the container gate of PR #57 on 30 September 2026.

The three families are now committed under `apps/web/app/fonts/` and loaded with `next/font/local`.
No retry was added: the point is to remove the dependency, not to make the flake quieter.

**The design is unchanged, and this was measured rather than assumed.** Same families, same weights
(400/600, 400/500/600, 400/500), same `latin` subset, same `display: swap`, same
`--eia-font-{serif,sans,mono}-loaded` variables, so nothing in `packages/ui` moved. Google serves one
*variable* woff2 per family and subset — its per-weight `@font-face` rules all point at one file —
so the layout declares one `src` entry per weight against one file, reproducing that structure
exactly. The committed bytes are the ones the Google loader was fetching: the same build run both
ways emitted woff2 files with the same three SHA-256 hashes, and a page rendered both ways produced
byte-identical screenshots at 2× scale across all three families and all five weights.

**Proved offline.** With a warm `deps` layer, `docker build --build-context
deps=docker-image://eia-deps:latest --network=none .` now completes; the same command against the
previous layout fails with the error above. `apps/web/test/build-hermeticity.test.ts` fails if any
file under `apps/web` imports a build-time network font loader again, and pins the three font
hashes. `pnpm fonts:check` re-derives the files from upstream and is deliberately not part of
`build`, `dev` or CI.

**One behavioural narrowing, stated rather than left to be discovered.** `subsets: ["latin"]` in
`next/font/google` selects what is *preloaded*, not what is downloaded: the loader was serving all
six subsets Google returns (15 files, 348 KB). Only `latin` is committed, so a character in
`latin-ext`, `greek`, `cyrillic`, `cyrillic-ext` or `vietnamese` now renders in the existing CSS
fallback chain instead of the brand font — the right glyph in the wrong typeface. Measured exposure
at the time of the change is none: no character in any of those ranges appears in the message
catalogues, `packages/ui`, `apps/web` or `fixtures/`. `docs/DEPENDENCIES.md` records what would
surface it and what adding a subset back costs.

Licences: all three are SIL Open Font License 1.1 with no Reserved Font Name; the licence text is
committed beside each font and recorded in `docs/DEPENDENCIES.md`.
