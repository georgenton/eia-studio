import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@eia/ui/tokens.css";

export const metadata: Metadata = {
  title: "EIA Studio",
  description: "Intelligent Environmental Impact Assessment Workspace — foundation",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-EC">
      <body>{children}</body>
    </html>
  );
}
