import { SOURCE_TYPE_LABEL, type ProvenanceFacets } from "@eia/domain";
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
 * The v0.2 SOURCE TYPE badge, spoken in Spanish (ADR-025). It is derived from the faceted
 * provenance at render time and is never read from a stored column (ADR-005, invariant 13); the
 * derivation returns the four keys and this only decides the words.
 */
export function ProvenanceBadge({ facets }: { facets: ProvenanceFacets }) {
  const label = deriveSourceTypeLabel(facets);
  if (!label) return null;
  return (
    <span
      className={`${styles.chip} ${styles.mono} ${styles[SOURCE_TYPE_TONE[label] ?? "neutral"]}`}
    >
      {SOURCE_TYPE_LABEL[label]}
    </span>
  );
}

/**
 * Block-level badge for a panel whose figures include a simulation, so a reader cannot mistake one
 * for the historical record (invariant 4).
 *
 * It says *Simulación operativa* rather than **DEMO**. The obligation is that the reader can tell
 * which numbers are real; shouting a three-letter English word at them on every panel achieved
 * that by making the product look like a sales demonstration of itself (ADR-025).
 */
export function DemoBadge({
  facets,
  label = "Simulación operativa",
}: {
  facets: ReadonlyArray<ProvenanceFacets>;
  label?: string;
}) {
  if (!needsDemoBadge(facets)) return null;
  return <span className={`${styles.chip} ${styles.demoSolid}`}>{label}</span>;
}
