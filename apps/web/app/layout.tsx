import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import "@eia/ui/tokens.css";

/**
 * The approved typographic system (design v0.2): Source Serif 4 for headings, figures and
 * quotations, Archivo for the interface, JetBrains Mono for codes, abscissas, scores and
 * timestamps.
 *
 * They are loaded from `./fonts`, through `next/font/local`, because `next/font/google`
 * downloads from `fonts.gstatic.com` **during `next build`** — and a build that reaches the
 * network is a build that fails when the network is not there. It failed exactly that way in the
 * container gate of PR #57: Next emitted the font CSS module and then could not resolve the
 * files it had never fetched. The remedy is to remove the dependency, not to retry it
 * (docs/EIA_COOLIFY_DEPLOYMENT.md).
 *
 * Each family is one file: Google serves one **variable** woff2 per family and subset, and the
 * per-weight `@font-face` rules it emits all point at it. The declarations below reproduce those
 * rules one for one — same families, same weights, same `latin` subset, same `display`, same CSS
 * variable names — so `packages/ui/src/tokens.css` and every component reading
 * `--eia-font-*-loaded` are unchanged.
 *
 * A weight is declared per face rather than as a range, because that is what Google's CSS does:
 * a face pinned to `400` renders at 400 for any requested weight that selects it. A range would
 * quietly start interpolating and change intermediate weights on screen.
 *
 * `adjustFontFallback` picks which system font the size-adjusted fallback is derived *from*;
 * the metrics themselves are read from the file by fontkit, so the swap-period fallback is as
 * accurate as the Google loader's was.
 *
 * The constants are named after the families on purpose. `next/font/local` uses the **variable's
 * own name** as the generated `font-family`, so `const serif` would emit `font-family: "serif"` —
 * legal while quoted, and a trap the first time anything writes it unquoted and gets the CSS
 * generic instead. `next/font/google` had no such hazard: it named faces after the family.
 *
 * Provenance, licences and the refresh procedure: `docs/DEPENDENCIES.md` § Self-hosted fonts.
 */
const sourceSerif4 = localFont({
  src: [
    { path: "./fonts/source-serif-4-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/source-serif-4-latin.woff2", weight: "600", style: "normal" },
  ],
  variable: "--eia-font-serif-loaded",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});
const archivo = localFont({
  src: [
    { path: "./fonts/archivo-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/archivo-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/archivo-latin.woff2", weight: "600", style: "normal" },
  ],
  // Archivo carries a `wdth` axis; Google pins the served faces to 100%, and so does this.
  declarations: [{ prop: "font-stretch", value: "100%" }],
  variable: "--eia-font-sans-loaded",
  display: "swap",
  adjustFontFallback: "Arial",
});
const jetBrainsMono = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jetbrains-mono-latin.woff2", weight: "500", style: "normal" },
  ],
  variable: "--eia-font-mono-loaded",
  display: "swap",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  title: "EIA Studio",
  description: "Workspace de estudios de impacto ambiental y social",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      className={`${sourceSerif4.variable} ${archivo.variable} ${jetBrainsMono.variable}`}
      lang="es-EC"
    >
      <body>{children}</body>
    </html>
  );
}
