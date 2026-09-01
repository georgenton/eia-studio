"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

import styles from "../foundation.module.css";

/** Minimal email + password sign-in / sign-up to exercise session → RequestContext. */
export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");
    const result =
      mode === "up"
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });
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
      <h1 className={styles.title}>{mode === "up" ? "Crear cuenta" : "Entrar"}</h1>
      <section className={styles.card}>
        <form onSubmit={onSubmit} className={styles.form}>
          {mode === "up" ? <input name="name" placeholder="Nombre" required /> : null}
          <input name="email" type="email" placeholder="Correo" required autoComplete="email" />
          <input
            name="password"
            type="password"
            placeholder="Contraseña (mínimo 12 caracteres)"
            required
            minLength={12}
            autoComplete={mode === "up" ? "new-password" : "current-password"}
          />
          {error ? <div className={styles.error}>{error}</div> : null}
          <button className={styles.button} type="submit" disabled={busy}>
            {mode === "up" ? "Crear cuenta" : "Entrar"}
          </button>
          <button
            className={`${styles.button} ${styles.buttonSecondary}`}
            type="button"
            onClick={() => setMode(mode === "up" ? "in" : "up")}
          >
            {mode === "up" ? "Ya tengo cuenta" : "Crear una cuenta"}
          </button>
        </form>
      </section>
    </main>
  );
}
