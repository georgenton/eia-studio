import type { ReactNode } from "react";

import styles from "./empty-state.module.css";

/**
 * System states (invariant 14). They apply to the container where the problem occurs, never to
 * the whole screen unless the whole screen is the problem, and their copy is the approved copy.
 */
export function SystemState({
  state,
  title,
  children,
  action,
  meta,
}: {
  state: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className={styles.state} data-system-state={state}>
      <span className={styles.stateLabel}>{state}</span>
      <h2 className={styles.title}>{title}</h2>
      {children ? <div className={styles.body}>{children}</div> : null}
      {meta ? <div className={styles.meta}>{meta}</div> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

/** Elegant empty slot, e.g. "Aún no hay más proyectos en este tenant". */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty} data-system-state="empty">
      <span aria-hidden="true" className={styles.plus}>
        +
      </span>
      <div className={styles.emptyText}>
        <div className={styles.emptyTitle}>{title}</div>
        {description ? <p className={styles.emptyDescription}>{description}</p> : null}
      </div>
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  );
}
