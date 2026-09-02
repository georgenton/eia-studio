import { CAPABILITY_KEYS, SYSTEM_PROFILES, navigationPresentation } from "@eia/domain";
import { listPortfolio } from "@eia/application";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRequestContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getTenantCapabilitySettings } from "@/lib/queries";

import styles from "../../foundation.module.css";
import { CreateProjectForm } from "./create-project-form";

export const dynamic = "force-dynamic";

export default async function TenantFoundationPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const result = await getRequestContext(tenant);
  if (result.kind === "unauthenticated") redirect("/sign-in");
  if (result.kind === "denied") {
    return (
      <main className={styles.page}>
        <div className={styles.eyebrow}>permission denied</div>
        <h1 className={styles.title}>No tienes acceso a esta sección</h1>
        <p className={styles.muted}>
          Tu rol {result.role ?? "actual"} no incluye {result.restrictedData}. Solicita acceso al
          coordinador del proyecto.
        </p>
        <Link href="/">Volver</Link>
      </main>
    );
  }
  const { ctx } = result;
  const projects = await listPortfolio(getDb(), ctx);
  const tenantSettings = await getTenantCapabilitySettings(ctx);

  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>
        <Link href="/">EIA Studio</Link> › {ctx.tenantSlug}
      </div>
      <h1 className={styles.title}>Contexto de organización</h1>
      <section className={styles.card}>
        <table className={styles.table}>
          <tbody>
            <tr>
              <th>tenant</th>
              <td className={styles.mono}>{ctx.tenantId}</td>
            </tr>
            <tr>
              <th>rol</th>
              <td>
                <span className={styles.chip}>{ctx.tenantRole}</span>
              </td>
            </tr>
            <tr>
              <th>permisos</th>
              <td className={styles.mono}>{[...ctx.permissions].sort().join(" · ")}</td>
            </tr>
            <tr>
              <th>request</th>
              <td className={styles.mono}>{ctx.requestId}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section className={styles.card}>
        <div className={styles.eyebrow}>Capabilities (efectivas · presentación)</div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>key</th>
              <th>enabled</th>
              <th>nav</th>
            </tr>
          </thead>
          <tbody>
            {CAPABILITY_KEYS.map((key) => (
              <tr key={key}>
                <td className={styles.mono}>{key}</td>
                <td>
                  {ctx.capabilities[key] ? (
                    <span className={`${styles.chip} ${styles.chipOk}`}>enabled</span>
                  ) : (
                    <span className={styles.chip}>disabled</span>
                  )}
                </td>
                <td className={styles.mono}>
                  {navigationPresentation(key, ctx.capabilities, tenantSettings)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className={styles.card}>
        <div className={styles.eyebrow}>Proyectos</div>
        {projects.length === 0 ? (
          <p className={styles.muted}>Aún no hay proyectos en este tenant.</p>
        ) : (
          <ul>
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/t/${ctx.tenantSlug}/p/${p.slug}`}>{p.name}</Link>{" "}
                <span className={styles.mono}>{p.profileKey}</span>
              </li>
            ))}
          </ul>
        )}
        {ctx.permissions.has("projects.create") ? (
          <CreateProjectForm tenantSlug={ctx.tenantSlug} profiles={[...SYSTEM_PROFILES.keys()]} />
        ) : null}
      </section>
    </main>
  );
}
