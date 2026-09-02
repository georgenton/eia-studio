import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./nav.module.css";

/*
 * Application navigation (IG1-004). These components construct routes and drive the App Router,
 * so they live with the application rather than in `@eia/ui`: the shared package holds visual
 * primitives and stays free of framework coupling. Everything visual they need — panels, chips,
 * metric cells, the shell — still comes from `@eia/ui`.
 */

export interface NavEntry {
  readonly key: string;
  readonly label: string;
  readonly href: string | null;
  readonly presentation: "ACTIVE" | "ANNOUNCED";
  readonly badge?: string | undefined;
  readonly external?: boolean | undefined;
}

/**
 * Capability-driven navigation (invariant 2). The list is produced from the resolved
 * `CapabilitySet` plus the shell-only presentation hint, so a HIDDEN capability contributes no
 * entry at all: no greyed-out item, no padlock. ANNOUNCED entries render as non-navigable
 * placeholders and are still `FeatureDisabled` on the server.
 *
 * Hiding an entry is never the authorization: every route calls `requireCapability`.
 */
export function CapabilityNav({
  entries,
  currentKey,
}: {
  entries: ReadonlyArray<NavEntry>;
  currentKey: string | null;
}) {
  return (
    <ul className={styles.list}>
      {entries.map((entry) => {
        const isCurrent = entry.key === currentKey;
        if (entry.presentation === "ANNOUNCED" || entry.href === null) {
          return (
            <li key={entry.key}>
              <span className={styles.announced} aria-disabled="true">
                <span>{entry.label}</span>
                {entry.badge ? <span className={styles.phase}>{entry.badge}</span> : null}
              </span>
            </li>
          );
        }
        return (
          <li key={entry.key}>
            <Link
              className={`${styles.item} ${isCurrent ? styles.active : ""}`}
              href={entry.href}
              aria-current={isCurrent ? "page" : undefined}
            >
              <span>{entry.label}</span>
              {entry.badge ? <span className={styles.badge}>{entry.badge}</span> : null}
              {entry.external ? (
                <span aria-hidden="true" className={styles.external}>
                  ↗
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Breadcrumb({ items }: { items: ReadonlyArray<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Ruta de navegación" className={styles.breadcrumb}>
      <ol className={styles.breadcrumbList}>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className={styles.breadcrumbItem}>
            {index > 0 ? (
              <span aria-hidden="true" className={styles.separator}>
                ›
              </span>
            ) : null}
            {item.href && index < items.length - 1 ? (
              <Link className={styles.breadcrumbLink} href={item.href}>
                {item.label}
              </Link>
            ) : (
              <span className={index === items.length - 1 ? styles.breadcrumbCurrent : undefined}>
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function ProvenanceLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <Link className={styles.provenanceLink} href={href} scroll={false} prefetch={false}>
      {children ?? "Ver origen"}
    </Link>
  );
}

export function ButtonLink({
  href,
  variant = "secondary",
  children,
}: {
  href: string;
  variant?: "primary" | "secondary";
  children: ReactNode;
}) {
  return (
    <Link className={`${styles.button} ${styles[variant]}`} href={href}>
      {children}
    </Link>
  );
}
