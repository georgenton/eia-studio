"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

import styles from "../foundation.module.css";

/**
 * Sign-in for provisioned identities. Public self-signup is disabled (IG0-H01); accounts are
 * created deliberately until the onboarding workflow exists, so this surface has no sign-up form.
 */
export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "No se pudo iniciar sesión");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>EIA Studio · acceso</div>
      <h1 className={styles.title}>Entrar</h1>
      <section className={styles.card}>
        <form onSubmit={onSubmit} className={styles.form}>
          <input name="email" type="email" placeholder="Correo" required autoComplete="email" />
          <input
            name="password"
            type="password"
            placeholder="Contraseña"
            required
            minLength={12}
            autoComplete="current-password"
          />
          {error ? <div className={styles.error}>{error}</div> : null}
          <button className={styles.button} type="submit" disabled={busy}>
            Entrar
          </button>
        </form>
      </section>
      <section className={styles.card}>
        <div className={styles.eyebrow}>Cuentas</div>
        <p className={styles.muted}>
          El registro público está deshabilitado. Las cuentas se aprovisionan de forma explícita
          hasta que exista el flujo de onboarding.
        </p>
      </section>
    </main>
  );
}
