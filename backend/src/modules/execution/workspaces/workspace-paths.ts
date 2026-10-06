/**
 * Paths into the app for notification links.
 *
 * Sibling of `workspace-invites-path.ts`. Only surfaces that live under
 * /w/<slug>/ would carry a slug; project and invite links stay global and are
 * built where they always were. Time (`timePath`) is deliberately bare: a
 * person's time spans workspaces, so its links carry no slug.
 *
 * D79 (A13): every time notification links to the Time pages. The team-page
 * builders (`teamTimePath`, `teamTimeEntryPath`, the D29 gap links to
 * `/w/<slug>/teams/<id>/time/{my-logs,team-logs}?log=<id>`) are gone; links
 * already stored in bell rows, pushes and emails keep resolving through the
 * web's redirect stubs on those routes.
 */

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
