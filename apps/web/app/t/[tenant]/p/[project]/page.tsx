import { CAPABILITY_KEYS } from "@eia/domain";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRequestContext } from "@/lib/context";

import styles from "../../../../foundation.module.css";

export const dynamic = "force-dynamic";

export default async function ProjectFoundationPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string }>;
}) {
  const { tenant, project } = await params;
  const result = await getRequestContext(tenant, project);
  if (result.kind === "unauthenticated") redirect("/sign-in");
  if (result.kind === "denied") {
    return (
      <main className={styles.page}>
        <div className={styles.eyebrow}>permission denied</div>
        <h1 className={styles.title}>No tienes acceso a este proyecto</h1>
        <p className={styles.muted}>
          Tu rol {result.role ?? "actual"} no incluye {result.restrictedData}.
        </p>
        <Link href={`/t/${tenant}`}>Volver</Link>
      </main>
    );
  }
  const { ctx } = result;
  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>
        <Link href="/">EIA Studio</Link> ›{" "}
        <Link href={`/t/${ctx.tenantSlug}`}>{ctx.tenantSlug}</Link> › {ctx.projectSlug}
      </div>
      <h1 className={styles.title}>Contexto de proyecto</h1>
      <section className={styles.card}>
        <table className={styles.table}>
          <tbody>
            <tr>
              <th>project</th>
              <td className={styles.mono}>{ctx.projectId}</td>
            </tr>
            <tr>
              <th>rol tenant</th>
              <td>
                <span className={styles.chip}>{ctx.tenantRole}</span>
              </td>
            </tr>
            <tr>
              <th>rol proyecto</th>
              <td>
                {ctx.projectRole ? (
                  <span className={styles.chip}>{ctx.projectRole}</span>
                ) : (
                  <span className={styles.muted}>sin asignación</span>
                )}
              </td>
            </tr>
            <tr>
              <th>acceso implícito OWNER</th>
              <td className={styles.mono}>{String(ctx.implicitOwnerProjectAccess)} (auditado)</td>
            </tr>
            <tr>
              <th>permisos</th>
              <td className={styles.mono}>{[...ctx.permissions].sort().join(" · ")}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section className={styles.card}>
        <div className={styles.eyebrow}>Capabilities efectivas · prueba de invocación servidor</div>
        <p className={styles.muted}>
          Cada enlace llama a un route handler que ejecuta{" "}
          <span className={styles.mono}>requireCapability</span>; los deshabilitados responden 403
          con el estado <em>feature disabled</em>.
        </p>
        <ul>
          {CAPABILITY_KEYS.map((key) => (
            <li key={key}>
              <Link
                className={styles.mono}
                href={`/t/${ctx.tenantSlug}/p/${ctx.projectSlug}/capabilities/${key}`}
              >
                {key}
              </Link>{" "}
              {ctx.capabilities[key] ? (
                <span className={`${styles.chip} ${styles.chipOk}`}>enabled</span>
              ) : (
                <span className={styles.chip}>disabled</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
