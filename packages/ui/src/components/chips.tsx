import type { ProvenanceFacets } from "@eia/domain";
import type { ReactNode } from "react";

import { deriveSourceTypeLabel, needsDemoBadge } from "../provenance-label";
import styles from "./chips.module.css";

export type ChipTone = "neutral" | "accent" | "ok" | "warn" | "crit" | "demo";

export function Chip({
  tone = "neutral",
  mono = false,
  children,
}: {
  tone?: ChipTone;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`${styles.chip} ${styles[tone]} ${mono ? styles.mono : ""}`}>{children}</span>
  );
}

/**
 * Status of a project or an item. The label is always present: colour alone never carries
 * meaning (design v0.2 §estados prediales, accessibility baseline).
 */
export function StatusChip({ label, tone = "neutral" }: { label: string; tone?: ChipTone }) {
  return (
    <span className={`${styles.chip} ${styles.rounded} ${styles[tone]}`}>
      <span aria-hidden="true" className={styles.dot} />
      {label}
    </span>
  );
}

const SOURCE_TYPE_TONE: Record<string, ChipTone> = {
  REAL_AGGREGATE: "ok",
  RECONSTRUCTED: "warn",
  ANONYMIZED: "accent",
  SYNTHETIC: "neutral",
};

/**
 * The v0.2 SOURCE TYPE badge. It is derived from the faceted provenance at render time and is
 * never read from a stored column (ADR-005, invariant 13).
 */
export function ProvenanceBadge({ facets }: { facets: ProvenanceFacets }) {
  const label = deriveSourceTypeLabel(facets);
  if (!label) return null;
  return (
    <span
      className={`${styles.chip} ${styles.mono} ${styles[SOURCE_TYPE_TONE[label] ?? "neutral"]}`}
    >
      {label}
    </span>
  );
}

/**
 * Block-level DEMO / SYNTHETIC badge. Shown on any panel where at least one composing value is a
 * demo simulation, so a reader cannot mistake it for the historical record (invariant 4).
 */
export function DemoBadge({
  facets,
  label = "DEMO / SYNTHETIC",
}: {
  facets: ReadonlyArray<ProvenanceFacets>;
  label?: string;
}) {
  if (!needsDemoBadge(facets)) return null;
  return <span className={`${styles.chip} ${styles.demoSolid}`}>{label}</span>;
}
