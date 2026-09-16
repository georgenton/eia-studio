"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useTranslator } from "@/components/i18n/locale-provider";
import { authClient } from "@/lib/auth-client";

import styles from "./sign-in.module.css";

export function SignInForm() {
  const t = useTranslator();
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
      setError(t("auth.failed"));
      return;
    }
    const next = searchParams.get("next");
    router.push(next && next.startsWith("/") ? next : "/");
    router.refresh();
  }

  return (
    // `method="post"`: submission is handled in JS, but if the button is pressed before the page
    // has hydrated the browser falls back to a native submit. Without this the fallback is a GET
    // and the password lands in the URL, history and any referrer.
    <form className={styles.form} method="post" onSubmit={onSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="email">
          {t("auth.email")}
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
          {t("auth.password")}
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
        {busy ? t("auth.signingIn") : t("auth.signIn")}
      </button>
    </form>
  );
}
