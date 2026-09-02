"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ChangeEvent } from "react";

import styles from "./context-switcher.module.css";

export interface SwitcherOption {
  readonly value: string;
  readonly label: string;
  readonly href: string;
}

/**
 * Tenant / project switcher (invariant 1). Switching context is a **navigation**, never a
 * mutation of server state: the new URL is the only thing that changes, and the server rebuilds
 * and re-verifies the RequestContext from it (TENANCY.md §4). The client never submits a tenant
 * or project id for authorization.
 */
export function ContextSwitcher({
  label,
  options,
  value,
  emptyLabel,
}: {
  label: string;
  options: ReadonlyArray<SwitcherOption>;
  value: string;
  emptyLabel?: string;
}) {
  const router = useRouter();
  const id = useId();
  const [pending, setPending] = useState(false);

  function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = options.find((option) => option.value === event.target.value);
    if (!next || next.value === value) return;
    setPending(true);
    router.push(next.href);
  }

  return (
    <div className={styles.wrap}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {options.length === 0 ? (
        <div className={styles.empty}>{emptyLabel ?? "Sin opciones"}</div>
      ) : (
        <select
          className={styles.select}
          id={id}
          value={value}
          onChange={onChange}
          disabled={pending}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
