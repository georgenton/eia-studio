"use client";

import { useEffect, useRef, type ReactNode } from "react";

import styles from "./provenance-drawer.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), select, textarea, input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Data Provenance drawer (invariant 12). One component serves every provenance-bearing value —
 * indicators, tables, layers, classifications, findings, reports — so it takes rendered children
 * rather than knowing anything about KPIs. Its content is produced on the server from a
 * `provenance_id`; this component only owns the overlay, focus and dismissal behaviour.
 *
 * Dismissal is delegated: the host decides what closing means. In this application it is a
 * navigation back to the page without `?prov=`, which keeps an open drawer shareable and
 * reproducible from the URL, exactly like the prototype's `prov` state. Taking `onClose` rather
 * than a route keeps the component free of any router (IG1-004).
 */
export function ProvenanceDrawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusTo = useRef<Element | null>(null);
  // Keep the latest handler without re-registering the key listener on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = () => onCloseRef.current();

  useEffect(() => {
    returnFocusTo.current = document.activeElement;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      const target = returnFocusTo.current;
      if (target instanceof HTMLElement && document.contains(target)) target.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className={styles.root}>
      <button
        aria-label="Cerrar el panel de procedencia"
        className={styles.overlay}
        onClick={close}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-label={title}
        aria-modal="true"
        className={styles.panel}
        ref={panelRef}
        role="dialog"
      >
        <div className={styles.header}>
          <div>
            <div className={styles.eyebrow}>ORIGEN DEL DATO</div>
            <h2 className={styles.title}>{title}</h2>
          </div>
          <button
            aria-label="Cerrar"
            className={styles.close}
            onClick={close}
            ref={closeRef}
            type="button"
          >
            ×
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}

export function ProvenanceField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={styles.fieldValue}>{children}</div>
    </div>
  );
}

export function ProvenanceSection({ children }: { children: ReactNode }) {
  return <div className={styles.section}>{children}</div>;
}
