import type { PublicEditorialPage } from "@eia/application";

import styles from "./public-editorial.module.css";

/**
 * A consultancy's public page.
 *
 * A server component with no client JavaScript at all: it renders text and links, and there is
 * nothing here to hydrate. That is also the security property — every string arrives as a React
 * text node, so a paragraph containing `<script>` is eleven characters on screen rather than a
 * tag. Nothing in this file interpolates HTML, and nothing loads a resource from a URL the
 * content supplied: an image is addressed by this product's own media route and an object id.
 */
export function PublicEditorialView({
  page,
  mediaBase,
  t,
  fmt,
}: {
  page: PublicEditorialPage;
  mediaBase: string;
  t: Record<string, string>;
  fmt: { date: (value: Date) => string };
}) {
  const { payload } = page;
  const assetOf = (id: string) => page.assets.find((a) => a.storedObjectId === id) ?? null;

  return (
    <main className={styles.page} lang={payload.locale}>
      <header className={styles.masthead}>
        <h1 className={styles.headline}>{payload.headline}</h1>
        {payload.subheadline === null ? null : (
          <p className={styles.subheadline}>{payload.subheadline}</p>
        )}
        <p className={styles.published}>
          {t.publishedOn} {fmt.date(page.publishedAt)}
        </p>
      </header>

      {payload.executiveSummary === null ? null : (
        <section aria-labelledby="resumen-gerencial" className={styles.summary}>
          <h2 className={styles.sectionTitle} id="resumen-gerencial">
            {t.summary}
          </h2>
          <dl className={styles.summaryList}>
            {(
              [
                ["findings", payload.executiveSummary.findings],
                ["implications", payload.executiveSummary.implications],
                ["measures", payload.executiveSummary.measures],
              ] as const
            ).map(([key, value]) =>
              value.trim() === "" ? null : (
                <div className={styles.summaryItem} key={key}>
                  <dt>{t[key]}</dt>
                  <dd>{value}</dd>
                </div>
              ),
            )}
          </dl>
          <p className={styles.attribution}>
            {payload.executiveSummary.accountable === null
              ? null
              : `${t.accountable}: ${payload.executiveSummary.accountable}`}
            {payload.executiveSummary.asOf === null ? null : ` · ${payload.executiveSummary.asOf}`}
          </p>
          {payload.executiveSummary.sources.length === 0 ? null : (
            <p className={styles.attribution}>
              {t.sources}: {payload.executiveSummary.sources.join(" · ")}
            </p>
          )}
        </section>
      )}

      {payload.sections.map((section) => (
        <section aria-labelledby={`s-${section.key}`} className={styles.section} key={section.key}>
          <h2 className={styles.sectionTitle} id={`s-${section.key}`}>
            {section.title}
          </h2>
          {/* `white-space: pre-wrap` keeps the author's paragraphs without admitting markup. */}
          {section.body.trim() === "" ? null : <p className={styles.body}>{section.body}</p>}
          {section.assets.length === 0 ? null : (
            <ul className={styles.assets}>
              {section.assets.map((asset) => {
                const authorised = assetOf(asset.storedObjectId);
                if (authorised === null) return null;
                const href = `${mediaBase}/${asset.storedObjectId}`;
                return (
                  <li className={styles.asset} key={asset.storedObjectId}>
                    {asset.role === "photo" ? (
                      <figure className={styles.figure}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- the media route
                            answers 303 to a short presigned URL, which the image optimiser cannot
                            follow and should not cache. */}
                        <img alt={asset.altText ?? ""} className={styles.photo} src={href} />
                        {asset.caption === null ? null : (
                          <figcaption className={styles.caption}>{asset.caption}</figcaption>
                        )}
                      </figure>
                    ) : (
                      <a className={styles.download} href={href}>
                        {asset.caption ?? t.download}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      {payload.team.length === 0 ? null : (
        <section aria-labelledby="equipo" className={styles.section}>
          <h2 className={styles.sectionTitle} id="equipo">
            {t.team}
          </h2>
          <ul className={styles.team}>
            {payload.team.map((member) => (
              <li
                className={member.photo === null ? styles.memberPlain : styles.member}
                key={member.key}
              >
                {member.photo === null ? null : (
                  // eslint-disable-next-line @next/next/no-img-element -- see above
                  <img
                    alt={member.photo.altText ?? ""}
                    className={styles.portrait}
                    src={`${mediaBase}/${member.photo.storedObjectId}`}
                  />
                )}
                <div>
                  <p className={styles.memberName}>{member.name}</p>
                  <p className={styles.memberRole}>
                    {member.position}
                    {member.speciality === null ? "" : ` · ${member.speciality}`}
                  </p>
                  {member.biography.trim() === "" ? null : (
                    <p className={styles.body}>{member.biography}</p>
                  )}
                  {member.projects.length === 0 ? null : (
                    <ul className={styles.memberProjects}>
                      {member.projects.map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
