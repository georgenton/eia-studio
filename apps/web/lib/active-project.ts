/**
 * Which project the rail points at when the URL names none.
 *
 * On a tenant-scope route — the Portfolio — there is no project in the path, but the rail still
 * has to render the workspace so the shell does not collapse (invariant 1). Something has to be
 * chosen, and the choice is not cosmetic: every rail link is built from it, so choosing a project
 * the caller cannot open turns the whole menu into `permission denied`.
 *
 * That is what used to happen. The rule was "the first project in the list", the list is every
 * project of the firm ordered by creation, and a tenant ADMIN administers all of them while being
 * assigned to perhaps one (D-015). An administrator opening the Portfolio and clicking *Centro de
 * control* was sent into the oldest study of the firm and refused — which reads as a broken
 * product rather than as the deliberate separation of administering a firm from working on a
 * study.
 *
 * Pure and separate from the shell so the rule can be asserted without rendering a server
 * component: this is the kind of decision that is easy to get wrong again.
 */
export interface SelectableProject {
  readonly slug: string;
  /**
   * Whether this caller may open the project, not merely list it. Comes from the database's own
   * `app.has_project_access`, so it cannot disagree with the policies the next request applies.
   */
  readonly accessible: boolean;
}

/**
 * The project in the URL wins — it was already verified for this request. Otherwise the first the
 * caller can actually open.
 *
 * The final fallback is deliberate: a caller who can open nothing still gets a rail, pointed at a
 * project that will refuse them in words they can read. An empty rail would say less, and the
 * refusal is the honest answer to "why can I not see this study?".
 */
export function chooseActiveProjectSlug(
  projectSlugFromUrl: string | null | undefined,
  projects: ReadonlyArray<SelectableProject>,
): string | null {
  if (projectSlugFromUrl) return projectSlugFromUrl;
  return projects.find((project) => project.accessible)?.slug ?? projects[0]?.slug ?? null;
}
