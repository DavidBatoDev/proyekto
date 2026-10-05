import { teamTimeEntryPath, teamTimePath, timePath } from './workspace-paths';

const ENTRY = '6f1c2b8e-4d3a-4f9b-9c1e-2a7d5e8b0c11';
const SHEET = '0b7e9d2a-1c4f-4e8a-b3d6-5f9a8c7e6d21';

describe('teamTimePath', () => {
  it('prefixes the workspace slug when the team has one', () => {
    expect(teamTimePath('acme', 'team-1', 'team-logs')).toBe(
      '/w/acme/teams/team-1/time/team-logs',
    );
  });

  /**
   * An unhomed team still gets a working link: the bare path is a real route
   * that redirects to the reader's last-visited workspace.
   */
  it('falls back to the bare path when the team has no workspace', () => {
    expect(teamTimePath(null, 'team-1', 'my-logs')).toBe(
      '/teams/team-1/time/my-logs',
    );
  });
});

describe('teamTimeEntryPath', () => {
  it('opens one entry on the team page', () => {
    expect(teamTimeEntryPath('acme', 'team-1', 'my-logs', ENTRY)).toBe(
      `/w/acme/teams/team-1/time/my-logs?log=${ENTRY}`,
    );
  });

  it('keeps the bare fallback for an unhomed team', () => {
    expect(teamTimeEntryPath(null, 'team-1', 'team-logs', ENTRY)).toBe(
      `/teams/team-1/time/team-logs?log=${ENTRY}`,
    );
  });
});

describe('timePath', () => {
  it('is the bare Time page with no argument', () => {
    expect(timePath()).toBe('/time');
    expect(timePath({})).toBe('/time');
  });

  it('links a timesheet', () => {
    expect(timePath({ timesheetId: SHEET })).toBe(`/time/timesheets/${SHEET}`);
  });

  it('links an entry', () => {
    expect(timePath({ entryId: ENTRY })).toBe(`/time?entry=${ENTRY}`);
  });

  it('links the waiting list', () => {
    expect(timePath({ hash: 'waiting' })).toBe('/time#waiting');
  });

  /** Time spans workspaces, so its links never carry a slug. */
  it('never carries a workspace slug', () => {
    for (const path of [
      timePath(),
      timePath({ timesheetId: SHEET }),
      timePath({ entryId: ENTRY }),
      timePath({ hash: 'waiting' }),
    ]) {
      expect(path.startsWith('/time')).toBe(true);
      expect(path).not.toContain('/w/');
    }
  });

  it('composes path, query and hash in URL order', () => {
    expect(timePath({ timesheetId: SHEET, entryId: ENTRY })).toBe(
      `/time/timesheets/${SHEET}?entry=${ENTRY}`,
    );
    expect(timePath({ entryId: ENTRY, hash: 'waiting' })).toBe(
      `/time?entry=${ENTRY}#waiting`,
    );
  });

  it('encodes ids, so a stray character cannot change the link', () => {
    expect(timePath({ entryId: 'a&b#c' })).toBe('/time?entry=a%26b%23c');
    expect(timePath({ timesheetId: '../x' })).toBe('/time/timesheets/..%2Fx');
  });
});
