import { listUserTenants } from "@eia/application";
import { ButtonLink, Panel, PanelBody, PanelHeader, SystemState } from "@eia/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";

import styles from "./entry.module.css";

export const dynamic = "force-dynamic";

/**
 * Entry point. The URL is the source of truth for tenant and project, so the root exists only to
 * put the user on one: a single membership goes straight to its Portfolio, several offer a
 * choice, none is an explicit state rather than an empty screen.
 */
export default async function EntryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const tenants = await listUserTenants(getDb(), user.subject);
  if (tenants.length === 1) redirect(`/t/${tenants[0]!.slug}`);

  return (
    <main className={styles.page}>
      {tenants.length === 0 ? (
        <SystemState state="empty" title="Todavía no perteneces a ninguna organización">
          <p>
            Las membresías las crea un Owner o un Admin de la organización. Pide acceso a quien
            administre tu consultora.
          </p>
        </SystemState>
      ) : (
        <Panel>
          <PanelHeader label="Organizaciones" />
          <PanelBody>
            <p className={styles.lead}>Selecciona la organización con la que quieres trabajar.</p>
            <ul className={styles.list}>
              {tenants.map((tenant) => (
                <li key={tenant.id}>
                  <Link className={styles.item} href={`/t/${tenant.slug}`}>
                    <span className={styles.name}>{tenant.name}</span>
                    <span className={styles.role}>{tenant.role}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      )}
      <div className={styles.footer}>
        <ButtonLink href="/health">Estado del servicio</ButtonLink>
      </div>
    </main>
  );
}
