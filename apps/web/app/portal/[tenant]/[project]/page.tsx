import { loadPublishedClientView } from "@eia/application";
import { can } from "@eia/domain";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ClientPublicationView } from "@/components/portal/client-view";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { accessForDomainError, resolveSurfaceAccess } from "@/lib/surface-access";

import styles from "@/components/portal/portal.module.css";

export const dynamic = "force-dynamic";

/**
 * The standalone client view — `Vista del cliente`.
 *
 * ## Why it is its own route group
 *
 * Invariant 3: the internal workspace and the client's page are different surfaces, not the same
 * page with fields hidden. This one has no rail, no breadcrumb, no command palette and no
 * operational vocabulary, and its content comes from one published row (ADR-009 §4).
 *
 * ## Why it is still behind the internal session
 *
 * External client authentication does not exist yet, and this wave does not build it: a
 * `ClientPortalGrant`, a portal cookie and a `PortalContext` that cannot be handed to an internal
 * use-case are a security surface of their own, and half of one is worse than none. So the route
 * requires an ordinary authenticated internal session with `portal.preview`, and says so in a strip
 * *outside* the client content. A coordinator can therefore show a client exactly what they would
 * see, from the protected staging environment, without anything being shared with anyone.
 *
 * There is no share token and no unguessable URL. The protection is the session, which is the only
 * kind that survives somebody forwarding a link.
 */
export default async function ClientPortalViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; project: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { tenant, project } = await params;
  const { v } = await searchParams;
  const access = await resolveSurfaceAccess(tenant, project, "portal");

  if (access.kind === "unauthenticated") redirect("/sign-in");
  // A capability that is not effective, and a caller who may not preview, answer identically:
  // this route must not confirm that a project has a portal to somebody who cannot open it.
  if (access.kind !== "ok") notFound();
  const { ctx } = access;
  if (!can(ctx, "portal.preview")) notFound();

  const requested = v === undefined ? undefined : Number.parseInt(v, 10);
  const sequence = requested !== undefined && Number.isInteger(requested) ? requested : undefined;

  let view;
  try {
    view = await loadPublishedClientView(getDb(), ctx, sequence ? { sequence } : {});
  } catch (error) {
    if (accessForDomainError(error)?.kind === "not-found") notFound();
    throw error;
  }

  const managementHref = `/t/${tenant}/p/${project}/portal`;

  if (!view) {
    return (
      <>
        <PreviewStrip managementHref={managementHref} />
        <main className={styles.page}>
          <div className={styles.content}>
            <p className={styles.empty} style={{ marginTop: 24 }}>
              Todavía no se ha publicado ninguna actualización para este proyecto. La consultora
              publica una actualización cuando decide qué información compartir.
            </p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <PreviewStrip
        managementHref={managementHref}
        note={
          view.sequence === view.available[0]?.sequence
            ? null
            : `Estás viendo una publicación anterior (${view.versionLabel}).`
        }
      />
      <ClientPublicationView basemap={getEnv().basemap} view={view} />
    </>
  );
}

/**
 * The one thing on this page that is not the client's: a discreet strip saying the link has not
 * been shared. It sits outside the client content on purpose — a banner stamped across the page
 * would make a real, dated publication of real historical figures look like a mock-up, which it
 * is not. What is provisional here is the *access mode*, not the study.
 */
function PreviewStrip({ managementHref, note }: { managementHref: string; note?: string | null }) {
  return (
    <div className={styles.preview}>
      <div className={styles.previewInner}>
        <span>
          Vista previa interna · este enlace aún no está compartido con el cliente
          {note ? ` · ${note}` : ""}
        </span>
        <span className={styles.previewActions}>
          <Link className={styles.previewLink} href={managementHref}>
            Volver a la gestión de publicaciones
          </Link>
        </span>
      </div>
    </div>
  );
}
