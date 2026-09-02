import type { ReactNode } from "react";

import styles from "./app-shell.module.css";

/**
 * Internal workspace shell (invariant 1): the rail and the topbar never collapse, so tenant and
 * project context is always on screen. The Client Portal is a different surface and never
 * reuses this shell (invariant 3).
 */
export function AppShell({
  rail,
  topbar,
  children,
  drawer,
}: {
  rail: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
  drawer?: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#contenido">
        Saltar al contenido
      </a>
      <nav className={styles.rail} aria-label="Navegación principal">
        {rail}
      </nav>
      <div className={styles.column}>
        <header className={styles.topbar}>{topbar}</header>
        <main className={styles.content} id="contenido" tabIndex={-1}>
          {children}
        </main>
      </div>
      {drawer}
    </div>
  );
}

export function RailBrand({ label }: { label: string }) {
  return (
    <div className={styles.brand}>
      <span aria-hidden="true" className={styles.mark} />
      <span className={styles.brandText}>{label}</span>
    </div>
  );
}

export function RailSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>{label}</div>
      {children}
    </div>
  );
}

export function RailFooter({ children }: { children: ReactNode }) {
  return <div className={styles.railFooter}>{children}</div>;
}

export function TopbarUser({ name, role }: { name: string; role: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className={styles.user}>
      <span aria-hidden="true" className={styles.avatar}>
        {initials}
      </span>
      <span className={styles.userText}>
        <span className={styles.userName}>{name}</span>
        <span className={styles.userRole}>{role}</span>
      </span>
    </div>
  );
}
