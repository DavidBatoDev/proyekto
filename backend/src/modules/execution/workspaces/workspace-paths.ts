/**
 * Paths into a workspace's organizational pages, for notification links.
 *
 * Sibling of `workspace-invites-path.ts`. Only surfaces that live under
 * /w/<slug>/ belong here; project and invite links stay global and are built
 * where they always were.
 */

export type TeamTimePage = 'my-logs' | 'team-logs';

/**
 * A team's time page. When the team has no workspace (deleted, or a row
 * predating the tier), the bare path is returned — the web redirects bare
 * paths to the reader's last-visited workspace, so the link still lands.
 */
export function teamTimePath(
  workspaceSlug: string | null,
  teamId: string,
  page: TeamTimePage,
): string {
  const bare = `/teams/${teamId}/time/${page}`;
  return workspaceSlug ? `/w/${workspaceSlug}${bare}` : bare;
}
