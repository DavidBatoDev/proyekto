/**
 * Paths into a workspace's organizational pages, for notification links.
 *
 * Sibling of `workspace-invites-path.ts`. Only surfaces that live under
 * /w/<slug>/ belong here; project and invite links stay global and are built
 * where they always were. The one exception is Time (`timePath`), which is
 * deliberately bare: a person's time spans workspaces, so its links carry no
 * slug.
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

/**
 * One entry on a team's time page: `teamTimePath(...)?log=<entryId>`.
 *
 * Comment, payout and timer notifications for team-context entries link here
 * until the web ships `/time`. The web keeps these routes as permanent
 * redirect shells, so a link built today stays valid after that.
 */
export function teamTimeEntryPath(
  workspaceSlug: string | null,
  teamId: string,
  page: TeamTimePage,
  entryId: string,
): string {
  return `${teamTimePath(workspaceSlug, teamId, page)}?log=${encodeURIComponent(entryId)}`;
}

/**
 * The Time page, always bare (no workspace slug):
 *   - `timePath()`                       → `/time`
 *   - `timePath({ timesheetId })`        → `/time/timesheets/<id>`
 *   - `timePath({ entryId })`            → `/time?entry=<id>`
 *   - `timePath({ hash: 'waiting' })`    → `/time#waiting`
 *
 * The parts compose (a sheet with an entry highlighted, say) in URL order:
 * path, then query, then hash.
 */
export function timePath(sub?: {
  timesheetId?: string;
  entryId?: string;
  hash?: 'waiting';
}): string {
  let path = sub?.timesheetId
    ? `/time/timesheets/${encodeURIComponent(sub.timesheetId)}`
    : '/time';
  if (sub?.entryId) path += `?entry=${encodeURIComponent(sub.entryId)}`;
  if (sub?.hash) path += `#${sub.hash}`;
  return path;
}
