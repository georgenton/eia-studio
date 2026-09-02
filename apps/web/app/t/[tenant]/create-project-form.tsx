"use client";

import { useActionState } from "react";

import { createProjectAction, type ActionState } from "@/lib/actions";

import styles from "../../foundation.module.css";

const initial: ActionState = { error: null };

export function CreateProjectForm({
  tenantSlug,
  profiles,
}: {
  tenantSlug: string;
  profiles: string[];
}) {
  const [state, action, pending] = useActionState(createProjectAction, initial);
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="tenant" value={tenantSlug} />
      <input name="slug" placeholder="slug del proyecto" required pattern="[a-z0-9-]{3,40}" />
      <input name="name" placeholder="Nombre del proyecto" required minLength={2} />
      <select name="profileKey" defaultValue={profiles[0]}>
        {profiles.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      {state.error ? <div className={styles.error}>{state.error}</div> : null}
      <button className={styles.button} type="submit" disabled={pending}>
        Crear proyecto desde plantilla
      </button>
    </form>
  );
}
