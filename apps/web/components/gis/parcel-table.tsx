"use client";

import type { ParcelRow } from "@eia/application";
import {
  formatChainage,
  PARCEL_SIDE_LABEL,
  PARCEL_STATUS_PRESENTATION,
  type ParcelStatus,
} from "@eia/domain";
import { formatDecimal, formatPercent } from "@eia/ui";
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFns,
  flexRender,
  globalFilteringFeature,
  rowSortingFeature,
  sortFns,
  useTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "./parcel-table.module.css";

/**
 * The parcel grid. TanStack Table is used **headless**: it owns sorting, filtering and row
 * selection state, and this component owns every element and class name, so the approved
 * institutional styling is not fighting a grid library's own markup.
 *
 * The table is also the accessibility contract of the GIS surface (§26). A canvas cannot be
 * navigated by a screen reader, so every parcel the map draws is a row here, every fact is
 * readable here, and selection is reachable from the keyboard. Nothing is map-only.
 *
 * Columns are the design's canonical set minus those that need data this slice does not have:
 * visits, social, ecosystem services and quality all belong to Field, Social and Quality.
 * Inventing them would be inventing observations.
 */
/**
 * v9 registers features explicitly instead of shipping every row model in the bundle: only
 * sorting and filtering are enabled, so nothing pays for pagination, grouping or virtualisation
 * this surface does not use.
 */
const tableFeatures = {
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns,
  sortFns,
};

const columnHelper = createColumnHelper<typeof tableFeatures, ParcelRow>();

export interface ParcelTableFilters {
  readonly search: string;
  readonly sector: string | null;
  readonly statuses: ReadonlySet<ParcelStatus>;
}

export function ParcelTable({
  parcels,
  filters,
  selectedParcelId,
  onSelect,
  onVisibleCountChange,
  workspaceHref,
}: {
  parcels: ReadonlyArray<ParcelRow>;
  filters: ParcelTableFilters;
  selectedParcelId: string | null;
  onSelect: (parcelId: string) => void;
  onVisibleCountChange?: (count: number) => void;
  workspaceHref: (parcelCode: string) => string;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "chainageM", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const bodyRef = useRef<HTMLTableSectionElement | null>(null);

  // `ColumnDef` is invariant in the cell value type, so a list of columns with different value
  // types has no single inferred array type. The annotation is the library's documented shape.
  const columns = useMemo<Array<ColumnDef<typeof tableFeatures, ParcelRow>>>(
    () =>
      [
        columnHelper.accessor("parcelCode", {
          header: "Código",
          cell: (info) => <span className={styles.code}>{info.getValue()}</span>,
          filterFn: "includesString",
        }),
        columnHelper.accessor("sectorLabel", {
          header: "Sector",
          cell: (info) => info.getValue() ?? "—",
          filterFn: (row, id, value) => !value || row.getValue(id) === value,
        }),
        columnHelper.accessor("chainageM", {
          header: "Abscisa",
          cell: (info) => {
            const value = info.getValue();
            return value === null ? (
              "—"
            ) : (
              <span className={styles.mono}>{formatChainage(value)}</span>
            );
          },
        }),
        columnHelper.accessor("side", {
          header: "Lado",
          cell: (info) => PARCEL_SIDE_LABEL[info.getValue()],
        }),
        columnHelper.accessor("status", {
          header: "Estado",
          cell: (info) => {
            const status = info.getValue();
            const presentation = PARCEL_STATUS_PRESENTATION[status];
            return (
              <span className={`${styles.state} ${styles[status]}`}>
                <span aria-hidden="true" className={styles.glyph}>
                  {presentation.glyph}
                </span>
                {presentation.label}
              </span>
            );
          },
          filterFn: (row, id, value: ReadonlyArray<string>) =>
            value.length === 0 || value.includes(row.getValue(id)),
        }),
        columnHelper.accessor("areaM2", {
          header: "Área",
          cell: (info) => {
            const value = info.getValue();
            return value === null ? "—" : `${formatDecimal(value / 10_000, 2)} ha`;
          },
        }),
        columnHelper.accessor("affectationRatio", {
          header: "Afectación",
          cell: (info) => {
            const ratio = info.getValue();
            if (ratio === null) return "—";
            const area = info.row.original.affectedAreaM2;
            return (
              <span className={styles.affectation}>
                <span>{formatPercent(ratio)}</span>
                {area === null ? null : (
                  <span className={styles.affectationArea}>
                    {formatDecimal(area / 10_000, 2)} ha
                  </span>
                )}
              </span>
            );
          },
        }),
      ] as Array<ColumnDef<typeof tableFeatures, ParcelRow>>,
    [],
  );

  const table = useTable({
    features: tableFeatures,
    data: parcels as ParcelRow[],
    columns,
    state: { sorting, columnFilters, globalFilter: filters.search },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    globalFilterFn: (row, _id, value: string) => {
      if (!value) return true;
      const needle = value.trim().toLowerCase();
      const parcel = row.original;
      return (
        parcel.parcelCode.toLowerCase().includes(needle) ||
        (parcel.sectorLabel ?? "").toLowerCase().includes(needle) ||
        (parcel.chainageM !== null && formatChainage(parcel.chainageM).includes(needle))
      );
    },
  });

  // Filters live in the parent so the map and the table cannot disagree about what is in view.
  useEffect(() => {
    table.getColumn("sectorLabel")?.setFilterValue(filters.sector ?? undefined);
    table.getColumn("status")?.setFilterValue([...filters.statuses]);
  }, [filters.sector, filters.statuses, table]);

  const rows = table.getRowModel().rows;
  useEffect(() => {
    onVisibleCountChange?.(rows.length);
  }, [rows.length, onVisibleCountChange]);

  // Selecting on the map scrolls the row into view; selecting in the table does not move the
  // list under the reader's cursor.
  useEffect(() => {
    if (!selectedParcelId) return;
    const row = bodyRef.current?.querySelector<HTMLElement>(
      `[data-parcel-id="${selectedParcelId}"]`,
    );
    if (row && document.activeElement !== row) {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [selectedParcelId]);

  if (rows.length === 0) {
    return (
      <div className={styles.empty} data-system-state="empty">
        <p className={styles.emptyTitle}>Ningún predio coincide con los filtros</p>
        <p className={styles.emptyNote}>
          Ajusta el código, el sector o el estado para volver a ver predios del corredor.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption className={styles.caption}>
          Predios del corredor. Selecciona un predio para resaltarlo en el mapa.
        </caption>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              <th scope="col">
                <span className={styles.srOnly}>Selección</span>
              </th>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    aria-sort={
                      sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"
                    }
                    key={header.id}
                    scope="col"
                  >
                    <button
                      className={styles.sortButton}
                      onClick={header.column.getToggleSortingHandler()}
                      type="button"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <span aria-hidden="true" className={styles.sortGlyph}>
                        {sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "↕"}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th scope="col">
                <span className={styles.srOnly}>Acciones</span>
              </th>
            </tr>
          ))}
        </thead>
        <tbody ref={bodyRef}>
          {rows.map((row) => {
            const isSelected = row.original.id === selectedParcelId;
            return (
              // Selection lives on a real button, not on the row. `aria-selected` is only
              // meaningful inside a grid or listbox; on an ordinary table row it is invalid ARIA,
              // and a `tabIndex` row is not an announced control. Clicking the row stays as a
              // mouse convenience, and `data-selected` carries the styling.
              <tr
                className={isSelected ? styles.selected : undefined}
                data-parcel-id={row.original.id}
                data-selected={isSelected ? "true" : "false"}
                key={row.id}
                onClick={() => onSelect(row.original.id)}
              >
                <td>
                  <button
                    aria-pressed={isSelected}
                    className={styles.selectButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(row.original.id);
                    }}
                    type="button"
                  >
                    <span aria-hidden="true">{isSelected ? "●" : "○"}</span>
                    <span className={styles.srOnly}>Seleccionar {row.original.parcelCode}</span>
                  </button>
                </td>
                {/* `getAllCells` rather than `getVisibleCells`: column visibility is a v9
                    feature this surface does not register, and enabling it to call a different
                    accessor would add state nothing toggles. */}
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
                <td>
                  <a className={styles.open} href={workspaceHref(row.original.parcelCode)}>
                    Abrir
                    <span className={styles.srOnly}> {row.original.parcelCode}</span>
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
