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

/**
 * The identity in the topbar, and — when a `menu` is given — the disclosure that reveals what you
 * can do about it.
 *
 * UX-001: a reviewer could not find how to sign out, and therefore could not move between the
 * synthetic roles the demo depends on. The control is a native `<details>`, so it opens with the
 * keyboard, announces its expanded state and works before hydration; the menu's contents are
 * supplied by the application, because this package knows nothing about sessions.
 */
export function TopbarUser({ name, role, menu }: { name: string; role: string; menu?: ReactNode }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const identity = (
    <>
      <span aria-hidden="true" className={styles.avatar}>
        {initials}
      </span>
      <span className={styles.userText}>
        <span className={styles.userName}>{name}</span>
        <span className={styles.userRole}>{role}</span>
      </span>
    </>
  );

  if (!menu) return <div className={styles.user}>{identity}</div>;

  return (
    // The label is on the <details>, which is the element that carries the group role and the
    // open state; the <summary> is its handle.
    <details className={styles.userMenu} aria-label={`Cuenta de ${name}`}>
      <summary className={styles.userSummary}>
        {identity}
        <span aria-hidden="true" className={styles.caret}>
          ▾
        </span>
      </summary>
      <div className={styles.userPanel}>{menu}</div>
    </details>
  );
}
