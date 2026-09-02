import type { MetricSnapshot } from "@eia/domain";
import type { ReactNode } from "react";

import { formatCount, formatDecimal, formatIsoDateShort } from "../format";
import styles from "./metric.module.css";

export type MetricTone = "default" | "warn" | "crit";

/** Render a metric's value with the precision its kind implies; never invent decimals. */
export function formatMetricValue(metric: MetricSnapshot): string {
  if (metric.definition.kind === "date") {
    return metric.dateValue ? formatIsoDateShort(metric.dateValue) : "—";
  }
  if (metric.numericValue === null) return "—";
  return metric.definition.kind === "decimal"
    ? formatDecimal(metric.numericValue)
    : formatCount(metric.numericValue);
}

/**
 * One cell of the KPI strip. The strip is a single panel with hairline separators, not a row of
 * eight cards (design v0.2 §2 "franja de KPI").
 */
export function MetricCell({
  label,
  value,
  note,
  tone = "default",
  provenanceLink,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  tone?: MetricTone;
  provenanceLink?: ReactNode;
}) {
  return (
    <div className={styles.cell}>
      <span className={styles.cellLabel}>{label}</span>
      <span className={`${styles.value} ${styles[tone]}`}>{value}</span>
      {note ? <span className={styles.note}>{note}</span> : null}
      {provenanceLink ? <span className={styles.provenance}>{provenanceLink}</span> : null}
    </div>
  );
}

export function MetricStrip({ children }: { children: ReactNode }) {
  return <div className={styles.strip}>{children}</div>;
}

/** Compact figure used on Portfolio cards (`PREDIOS 141`). */
export function MetricFigure({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: MetricTone;
}) {
  return (
    <div className={styles.figure}>
      <span className={styles.cellLabel}>{label}</span>
      <span className={`${styles.figureValue} ${styles[tone]}`}>{value}</span>
    </div>
  );
}

export function ProgressBar({
  ratio,
  label,
  valueLabel,
}: {
  ratio: number;
  label: string;
  valueLabel: string;
}) {
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <div className={styles.progressWrap}>
      <div className={styles.progressHead}>
        <span className={styles.progressLabel}>{label}</span>
        <span className={styles.progressValue}>{valueLabel}</span>
      </div>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-valuenow={Math.round(pct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={styles.progressFill} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
