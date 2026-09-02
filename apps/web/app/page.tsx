import { listUserTenants } from "@eia/application";
import Link from "next/link";

import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { APP_VERSION, GIT_SHA } from "@/lib/version";

import { CreateTenantForm } from "./create-tenant-form";
import styles from "./foundation.module.css";

export const dynamic = "force-dynamic";

/**
 * Foundation page (Slice 0): proves session → domain user → memberships → context. It is not a
 * product surface; Portfolio and the shell arrive with their own slices.
 */
export default async function FoundationPage() {
  const env = getEnv();
  const user = await getSessionUser();
  const tenants = user ? await listUserTenants(getDb(), user.subject) : [];

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>EIA Studio · foundation</div>
      <h1 className={styles.title}>Plataforma en construcción</h1>
      <section className={styles.card}>
        <div className={styles.mono}>
          env {env.app.APP_ENV} · version {APP_VERSION} · {GIT_SHA.slice(0, 12)}
        </div>
        <p className={styles.muted}>
          Slice 0: tenancy, autorización, capabilities y RLS. Sin superficies de producto todavía.{" "}
          <Link href="/health">/health</Link>
        </p>
      </section>
      {!user ? (
        <section className={styles.card}>
          <p>No has iniciado sesión.</p>
          <Link className={styles.button} href="/sign-in">
            Entrar o crear cuenta
          </Link>
        </section>
      ) : (
        <>
          <section className={styles.card}>
            <div className={styles.eyebrow}>Sesión</div>
            <p>
              <span className={styles.mono}>{user.subject}</span>
            </p>
            <div className={styles.eyebrow}>Organizaciones</div>
            {tenants.length === 0 ? (
              <p className={styles.muted}>Aún no perteneces a ninguna organización.</p>
            ) : (
              <ul>
                {tenants.map((t) => (
                  <li key={t.id}>
                    <Link href={`/t/${t.slug}`}>{t.name}</Link>{" "}
                    <span className={styles.chip}>{t.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={styles.card}>
            <div className={styles.eyebrow}>Nueva organización</div>
            <CreateTenantForm />
          </section>
        </>
      )}
    </main>
  );
}
