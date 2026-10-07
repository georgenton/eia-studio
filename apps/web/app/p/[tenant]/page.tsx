import { loadPublicEditorialIndex } from "@eia/application";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDb } from "@/lib/db";
import { getI18n } from "@/lib/locale";

import styles from "@/components/portal/public-editorial.module.css";

export const dynamic = "force-dynamic";

/**
 * A consultancy's public landing: the firm, and the roads it has published.
 *
 * ## What it does not do
 *
 * It does not list projects and filter them. `loadPublicEditorialIndex` queries the published
 * rows alone, under the same public policy as a single page, so a project with no publication,
 * a withdrawn one, an archived one and a private one are all simply **absent** — there is no list
 * to filter and no condition anybody can forget. A road that is withdrawn disappears from here by
 * the same mechanism that takes its page down.
 *
 * The firm's name is the editorial profile's, and the fallback is its own slug. Neither
 * "Visión Ambiental" nor any other tenant's name is written anywhere in this codebase.
 *
 * A tenant with nothing visible is a 404, exactly like one that does not exist: whether a
 * consultancy uses this product is not a fact a URL should be able to establish.
 */
export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const index = await loadPublicEditorialIndex(getDb(), { tenantSlug: tenant });
  if (index === null) return { title: "EIA Studio" };
  return {
    title: index.tenantName,
    description: index.engagementLabel ?? undefined,
    robots: { index: false, follow: false },
  };
}

export default async function PublicTenantPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const index = await loadPublicEditorialIndex(getDb(), { tenantSlug: tenant });
  if (index === null) notFound();
  const { fmt } = await getI18n();

  return (
    <main className={styles.page}>
      <header className={styles.masthead}>
        <h1 className={styles.headline}>{index.tenantName}</h1>
        {index.engagementLabel === null ? null : (
          <p className={styles.subheadline}>{index.engagementLabel}</p>
        )}
      </header>

      <ul className={styles.assets}>
        {index.projects.map((entry) => (
          <li key={entry.projectSlug}>
            <Link className={styles.download} href={`/p/${tenant}/${entry.projectSlug}`}>
              {entry.headline}
            </Link>
            {entry.subheadline === null ? null : (
              <p className={styles.caption}>{entry.subheadline}</p>
            )}
            <p className={styles.caption}>{fmt.dateTime(entry.publishedAt)}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
