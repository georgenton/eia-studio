"use client";

import { ProvenanceDrawer } from "@eia/ui";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Binds the framework-agnostic drawer from `@eia/ui` to this application's routing: closing means
 * navigating back to the page without `?prov=`, so an open drawer stays shareable and
 * reproducible from the URL. The drawer itself knows nothing about routes (IG1-004).
 */
export function RouteDrawer({
  title,
  closeHref,
  children,
}: {
  title: string;
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <ProvenanceDrawer onClose={() => router.push(closeHref, { scroll: false })} title={title}>
      {children}
    </ProvenanceDrawer>
  );
}
