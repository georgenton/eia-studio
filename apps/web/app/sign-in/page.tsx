import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInForm } from "./sign-in-form";
import styles from "./sign-in.module.css";

export const metadata: Metadata = { title: "Entrar · EIA Studio" };

/**
 * Sign-in for provisioned identities. Public self-signup is disabled (IG0-H01), so this surface
 * deliberately has no registration, no password reset and no email delivery: accounts are created
 * by an operator until the onboarding workflow exists.
 */
export default function SignInPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.brand}>
          <span aria-hidden="true" className={styles.mark} />
          <span className={styles.brandText}>EIA Studio</span>
        </div>
        <h1 className={styles.title}>Entrar al workspace</h1>
        <p className={styles.subtitle}>
          Estudios de impacto ambiental y social, con trazabilidad de extremo a extremo.
        </p>
        {/* `useSearchParams` reads the post-sign-in destination, so the form is a client
            boundary that must not be prerendered with the rest of the page. */}
        <Suspense fallback={<div className={styles.form} aria-hidden="true" />}>
          <SignInForm />
        </Suspense>
        <p className={styles.note}>
          El registro público está deshabilitado. Las cuentas se aprovisionan de forma explícita por
          la organización.
        </p>
      </section>
      <aside className={styles.aside}>
        <blockquote className={styles.quote}>
          Toda cifra publicada conserva su cadena de procedencia hasta el registro de campo.
        </blockquote>
      </aside>
    </main>
  );
}
