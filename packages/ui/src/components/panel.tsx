import type { ReactNode } from "react";

import styles from "./panel.module.css";

/**
 * The one container of the design: white surface, 1px border, 5px radius, hairline header.
 * Everything in the workspace is composed from it rather than from ad-hoc cards.
 */
export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return <section className={`${styles.panel} ${className ?? ""}`}>{children}</section>;
}

export function PanelHeader({
  label,
  note,
  badge,
  action,
}: {
  label: string;
  note?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <span className={styles.label}>{label}</span>
      {badge}
      {note ? <span className={styles.note}>{note}</span> : null}
      {action ? <span className={styles.action}>{action}</span> : null}
    </header>
  );
}

export function PanelBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return <div className={`${styles.body} ${className ?? ""}`}>{children}</div>;
}

export function Label({ children }: { children: ReactNode }) {
  return <span className={styles.label}>{children}</span>;
}
