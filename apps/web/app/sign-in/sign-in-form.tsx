"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

import styles from "./sign-in.module.css";

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
      setError("No pudimos iniciar sesión con esos datos.");
      return;
    }
    const next = searchParams.get("next");
    router.push(next && next.startsWith("/") ? next : "/");
    router.refresh();
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="email">
          Correo institucional
        </label>
        <input
          autoComplete="email"
          className={styles.input}
          id="email"
          name="email"
          required
          type="email"
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="password">
          Contraseña
        </label>
        <input
          autoComplete="current-password"
          className={styles.input}
          id="password"
          minLength={12}
          name="password"
          required
          type="password"
        />
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <button className={styles.submit} disabled={busy} type="submit">
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
