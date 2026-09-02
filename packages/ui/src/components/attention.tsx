import type { ReactNode } from "react";

import styles from "./attention.module.css";

export type AttentionTone = "high" | "medium" | "low";

/**
 * One row of "Requiere atención hoy". Severity is communicated by a dot **and** a text label:
 * colour alone never carries meaning.
 */
export function AttentionRow({
  severity,
  severityLabel,
  title,
  note,
  surfaceLabel,
  action,
}: {
  severity: AttentionTone;
  severityLabel: string;
  title: string;
  note?: string | null;
  surfaceLabel: string;
  action?: ReactNode;
}) {
  return (
    <li className={styles.row}>
      <span className={`${styles.dot} ${styles[severity]}`} aria-hidden="true" />
      <span className={styles.main}>
        <span className={styles.title}>{title}</span>
        {note ? <span className={styles.note}>{note}</span> : null}
        <span className={styles.severity}>Severidad {severityLabel}</span>
      </span>
      <span className={styles.surface}>{surfaceLabel}</span>
      <span className={styles.action}>{action}</span>
    </li>
  );
}

export function AttentionList({ children }: { children: ReactNode }) {
  return <ul className={styles.list}>{children}</ul>;
}

export function ActivityTable({
  caption,
  rows,
}: {
  caption: string;
  rows: ReadonlyArray<{
    id: string;
    time: string;
    actor: string;
    action: string;
    object: string | null;
  }>;
}) {
  return (
    <table className={styles.table}>
      <caption className={styles.caption}>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Hora</th>
          <th scope="col">Actor</th>
          <th scope="col">Acción</th>
          <th scope="col">Objeto</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className={styles.mono}>{row.time}</td>
            <td>{row.actor}</td>
            <td>{row.action}</td>
            <td className={styles.mono}>{row.object ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
