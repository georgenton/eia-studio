"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

import styles from "./account-menu.module.css";

/**
 * What the topbar's account disclosure contains (UX-001).
 *
 * The manual review found no way to sign out, which also meant no way to move between the
 * synthetic identities the demo roles live on. So the menu says who you are and offers exactly one
 * action.
 *
 * There is deliberately **no role switcher**. Roles here are memberships resolved server-side from
 * the signed-in user; a control that appeared to change one would either be a lie about the
 * session or a genuine privilege change driven from a browser. Changing role means signing out and
 * signing in as someone else, and the hint says so.
 */
export function AccountMenu({ email, roleLabel }: { email: string | null; roleLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);
    const result = await authClient.signOut();
    if (result.error) {
      setBusy(false);
      setError("No pudimos cerrar la sesión. Inténtalo de nuevo.");
      return;
    }
    // `replace`, not `push`: the workspace must not be one Back press away from a closed session.
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <>
      <div className={styles.identity}>
        {email ? <span className={styles.email}>{email}</span> : null}
        <span className={styles.hint}>Sesión iniciada como {roleLabel}.</span>
      </div>
      <p className={styles.hint}>
        Para revisar el producto con otro rol, cierra sesión e inicia con la identidad
        correspondiente.
      </p>
      <button className={styles.signOut} type="button" onClick={signOut} disabled={busy}>
        {busy ? "Cerrando sesión…" : "Cerrar sesión"}
      </button>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
