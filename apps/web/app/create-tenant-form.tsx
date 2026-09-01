"use client";

import { useActionState } from "react";

import { createTenantAction, type ActionState } from "@/lib/actions";

import styles from "./foundation.module.css";

const initial: ActionState = { error: null };

export function CreateTenantForm() {
  const [state, action, pending] = useActionState(createTenantAction, initial);
  return (
    <form action={action} className={styles.form}>
      <input
        name="slug"
        placeholder="slug (p. ej. mi-consultora)"
        required
        pattern="[a-z0-9-]{3,40}"
      />
      <input name="name" placeholder="Nombre de la organización" required minLength={2} />
      {state.error ? <div className={styles.error}>{state.error}</div> : null}
      <button className={styles.button} type="submit" disabled={pending}>
        Crear organización
      </button>
    </form>
  );
}
