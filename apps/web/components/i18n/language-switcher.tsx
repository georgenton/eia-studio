"use client";

import { LOCALE_ENDONYM, LOCALES, type Locale } from "@eia/i18n";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { setLocaleAction } from "@/lib/locale-actions";

import { useLocale, useTranslator } from "./locale-provider";

import styles from "./language-switcher.module.css";

/**
 * Two buttons, named in their own languages.
 *
 * A language menu is the one control a reader may need *before* they can read the interface, so
 * the options say «Español» and «English» rather than being translated into whichever language is
 * currently wrong for them.
 *
 * The choice is written as a cookie by a server action and the page re-renders on the server, so
 * there is no flash of the previous language and nothing to hydrate.
 */
export function LanguageSwitcher() {
  const current = useLocale();
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const choose = (locale: Locale) => {
    if (locale === current || pending) return;
    startTransition(async () => {
      await setLocaleAction(locale);
      router.refresh();
    });
  };

  return (
    <div className={styles.switcher}>
      <span className={styles.label}>{t("locale.label")}</span>
      <div className={styles.options} role="group" aria-label={t("locale.label")}>
        {LOCALES.map((locale) => (
          <button
            aria-pressed={locale === current}
            className={locale === current ? styles.active : styles.option}
            disabled={pending}
            key={locale}
            lang={locale}
            onClick={() => choose(locale)}
            type="button"
          >
            {LOCALE_ENDONYM[locale]}
          </button>
        ))}
      </div>
    </div>
  );
}
