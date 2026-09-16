import type { Metadata } from "next";
import { Suspense } from "react";

import { LocaleProvider } from "@/components/i18n/locale-provider";
import { getLocale, getTranslator } from "@/lib/locale";

import { SignInForm } from "./sign-in-form";
import styles from "./sign-in.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: `${t("auth.signIn")} · EIA Studio` };
}

/**
 * Sign-in for provisioned identities. Public self-signup is disabled (IG0-H01), so this surface
 * deliberately has no registration, no password reset and no email delivery: accounts are created
 * by an operator until the onboarding workflow exists.
 */
export default async function SignInPage() {
  const t = await getTranslator();
  const locale = await getLocale();
  return (
    <LocaleProvider locale={locale}>
      <main className={styles.page}>
        <section className={styles.panel}>
          <div className={styles.brand}>
            <span aria-hidden="true" className={styles.mark} />
            <span className={styles.brandText}>EIA Studio</span>
          </div>
          <h1 className={styles.title}>{t("auth.signInTitle")}</h1>
          <p className={styles.subtitle}>{t("auth.signInSubtitle")}</p>
          {/* `useSearchParams` reads the post-sign-in destination, so the form is a client
            boundary that must not be prerendered with the rest of the page. */}
          <Suspense fallback={<div className={styles.form} aria-hidden="true" />}>
            <SignInForm />
          </Suspense>
          <p className={styles.note}>{t("auth.signUpDisabled")}</p>
        </section>
        <aside className={styles.aside}>
          <blockquote className={styles.quote}>{t("auth.provenancePromise")}</blockquote>
        </aside>
      </main>
    </LocaleProvider>
  );
}
