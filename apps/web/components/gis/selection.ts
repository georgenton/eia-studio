"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * The one canonical selection of the GIS surface (invariant 6).
 *
 * Map, table and contextual panel read the same `selectedParcelId`; none of them owns a copy.
 * That is what makes "select a row, the polygon highlights" and "click a polygon, the row
 * highlights" the same operation rather than two synchronisation paths that can disagree.
 */
export interface ParcelSelection {
  readonly selectedParcelId: string | null;
  readonly select: (parcelId: string | null) => void;
  readonly toggle: (parcelId: string) => void;
  readonly isSelected: (parcelId: string) => boolean;
}

export function useParcelSelection(initial: string | null = null): ParcelSelection {
  const [selectedParcelId, setSelected] = useState<string | null>(initial);
  const select = useCallback((parcelId: string | null) => setSelected(parcelId), []);
  const toggle = useCallback(
    (parcelId: string) => setSelected((current) => (current === parcelId ? null : parcelId)),
    [],
  );
  const isSelected = useCallback(
    (parcelId: string) => parcelId === selectedParcelId,
    [selectedParcelId],
  );
  return useMemo(
    () => ({ selectedParcelId, select, toggle, isSelected }),
    [selectedParcelId, select, toggle, isSelected],
  );
}
