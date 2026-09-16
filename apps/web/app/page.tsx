import { listUserTenants } from "@eia/application";
import { Panel, PanelBody, PanelHeader, SystemState } from "@eia/ui";
import { ButtonLink } from "@/components/navigation";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getTranslator } from "@/lib/locale";

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
  const t = await getTranslator();

  const tenants = await listUserTenants(getDb(), user.subject);
  if (tenants.length === 1) redirect(`/t/${tenants[0]!.slug}`);

  return (
    <main className={styles.page}>
      {tenants.length === 0 ? (
        <SystemState state="empty" title={t("shell.noMembershipTitle")}>
          <p>{t("shell.noMembershipBody")}</p>
        </SystemState>
      ) : (
        <Panel>
          <PanelHeader label={t("shell.organisations")} />
          <PanelBody>
            <p className={styles.lead}>{t("shell.chooseOrganisation")}</p>
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
