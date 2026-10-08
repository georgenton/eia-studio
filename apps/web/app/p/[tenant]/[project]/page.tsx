import { loadPublicEditorialPage } from "@eia/application";
import { notFound } from "next/navigation";

import { PublicEditorialView } from "@/components/portal/public-editorial";
import { getDb } from "@/lib/db";
import { getI18n } from "@/lib/locale";

export const dynamic = "force-dynamic";

/**
 * The one page in this product a request with **no session** is served.
 *
 * ## Why it is not under `/portal`
 *
 * `/portal/:tenant/:project` is the client view, and it still requires an internal session
 * because external client authentication does not exist (ADR-027, TD-078). This is a different
 * thing: a consultancy's own public presentation, which is meant to be read by anyone with the
 * link. Putting the two on one path would have made "does this need a session?" a property of
 * the request rather than of the route.
 *
 * ## What it can reach
 *
 * One row. `loadPublicEditorialPage` opens its transaction with `surface: "public"` and no
 * tenant, project or user, and exactly two policies admit that — SELECT on the editorial
 * publication and on its attachments, only while visible (migration 0052). Every other table in
 * every schema still denies a transaction with no tenant, so there is no draft, no other tenant,
 * no survey answer and no parcel reachable from here even by a query written to try.
 *
 * A slug that matches nothing, a page that was withdrawn and a project that does not exist are
 * the same 404, for the reason every other surface gives: a distinguishable answer is an oracle.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; project: string }>;
}) {
  const { tenant, project } = await params;
  const page = await loadPublicEditorialPage(getDb(), { tenantSlug: tenant, projectSlug: project });
  if (page === null) return { title: "EIA Studio" };
  return {
    title: page.payload.headline,
    description: page.payload.subheadline ?? undefined,
    // Nothing here is indexed by default: a firm decides when its page is findable, and the
    // product's guess should be the quiet one.
    robots: { index: false, follow: false },
  };
}

export default async function PublicEditorialPage({
  params,
}: {
  params: Promise<{ tenant: string; project: string }>;
}) {
  const { tenant, project } = await params;
  const page = await loadPublicEditorialPage(getDb(), { tenantSlug: tenant, projectSlug: project });
  if (page === null) notFound();
  const { t, fmt } = await getI18n();

  return (
    <PublicEditorialView
      fmt={{ date: (d: Date) => fmt.dateTime(d) }}
      mediaBase={`/p/${tenant}/${project}/media`}
      page={page}
      t={{
        publishedOn: t("portal.editorial.publicPublishedOn"),
        summary: t("portal.editorial.publicSummary"),
        findings: t("portal.editorial.findings"),
        implications: t("portal.editorial.implications"),
        measures: t("portal.editorial.measures"),
        accountable: t("portal.editorial.accountable"),
        sources: t("portal.editorial.sources"),
        team: t("portal.editorial.team"),
        download: t("portal.editorial.download"),
      }}
    />
  );
}
