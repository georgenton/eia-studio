import type { Metadata } from "next";
import { Archivo, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";

import "@eia/ui/tokens.css";

/**
 * The approved typographic system (design v0.2): Source Serif 4 for headings, figures and
 * quotations, Archivo for the interface, JetBrains Mono for codes, abscissas, scores and
 * timestamps. Loaded through `next/font` so they are self-hosted and carry no layout shift.
 */
const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--eia-font-serif-loaded",
  display: "swap",
});
const sans = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--eia-font-sans-loaded",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--eia-font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EIA Studio",
  description: "Workspace de estudios de impacto ambiental y social",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={`${serif.variable} ${sans.variable} ${mono.variable}`} lang="es-EC">
      <body>{children}</body>
    </html>
  );
}
