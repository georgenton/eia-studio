import { loadPrintableInvitation } from "@eia/application";
import { can } from "@eia/domain";
import { notFound, redirect } from "next/navigation";

import { PrintButton } from "@/components/portal/print-button";
import { getDb } from "@/lib/db";
import { getI18n } from "@/lib/locale";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";

import styles from "./print.module.css";

export const dynamic = "force-dynamic";

/**
 * The sheet a technician carries to a gate.
 *
 * HTML and print CSS, and no PDF generator: the browser already prints, and a second rendering
 * pipeline for one page of text would be a dependency, an upload namespace and a worker job for
 * nothing. No QR, no email, no SMS — none is in this block, and a QR on a paper invitation is a
 * tracking mechanism nobody asked for.
 *
 * **It creates no account.** The page says so, because an invitation that looked like a login
 * would send people looking for one.
 *
 * What is on it is only what the recipient needs: the firm, the project, the convocation, the
 * place and time, their parcel, and a reference. No technician, no attempt, no evidence, no
 * coordinate — what this product knows about its own operation is not the recipient's to hold.
 */
export default async function PrintableInvitationPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string; invitationId: string }>;
}) {
  const { tenant, project, invitationId } = await params;
  const access = await resolveSurfaceAccess(tenant, project, "field");
  if (access.kind === "unauthenticated") redirect("/sign-in");
  if (access.kind !== "ok") notFound();
  if (!can(access.ctx, "field.socializations.manage")) notFound();

  const { t, fmt } = await getI18n();

  // Data first, JSX after: constructing elements inside a try/catch does not catch their render
  // errors anyway, and separating the two makes the failure path explicit.
  let invitation: Awaited<ReturnType<typeof loadPrintableInvitation>>;
  try {
    invitation = await loadPrintableInvitation(getDb(), access.ctx, invitationId);
  } catch (error) {
    if (accessForDomainError(error)?.kind === "not-found") notFound();
    throw error;
  }

  return (
    <main className={styles.sheet}>
      <header className={styles.head}>
        {invitation.firmName === null ? null : <p className={styles.firm}>{invitation.firmName}</p>}
        {invitation.engagementLabel === null ? null : (
          <p className={styles.engagement}>{invitation.engagementLabel}</p>
        )}
        <h1 className={styles.title}>{t("field.socializations.printTitle")}</h1>
      </header>

      <p className={styles.greeting}>
        {t("field.socializations.printGreeting")} <strong>{invitation.projectName}</strong>.
      </p>

      <h2 className={styles.event}>{invitation.eventTitle}</h2>
      {invitation.purpose === null ? null : <p className={styles.purpose}>{invitation.purpose}</p>}

      <dl className={styles.facts}>
        <dt>{t("field.socializations.printWhen")}</dt>
        <dd>
          {fmt.dateTimeInZone(invitation.startsAt, invitation.timezone)} · {invitation.timezone}
        </dd>
        <dt>{t("field.socializations.printWhere")}</dt>
        <dd>{invitation.locationLabel}</dd>
        <dt>{t("field.socializations.printParcel")}</dt>
        <dd>{invitation.parcelCode}</dd>
        {invitation.recipientLabel === null ? null : (
          <>
            <dt>{t("field.socializations.recipient")}</dt>
            <dd>{invitation.recipientLabel}</dd>
          </>
        )}
        <dt>{t("field.socializations.printReference")}</dt>
        <dd className={styles.reference}>{invitation.invitationId}</dd>
      </dl>

      <p className={styles.note}>{t("field.socializations.printNoAccount")}</p>
      <div className={styles.noPrint}>
        <PrintButton label={t("field.socializations.printTitle")} />
      </div>
    </main>
  );
}
