import * as paths from './workspace-paths';
import { timePath } from './workspace-paths';

const ENTRY = '6f1c2b8e-4d3a-4f9b-9c1e-2a7d5e8b0c11';
const SHEET = '0b7e9d2a-1c4f-4e8a-b3d6-5f9a8c7e6d21';

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

/**
 * D79 (A13): new notifications never link to the team time pages. Old
 * `…/time/{my-logs,team-logs}?log=` links stay valid through the web's
 * redirect stubs, so nothing here builds them any more.
 */
describe('team time page builders (retired by D79)', () => {
  it('no longer exports the team page link builders', () => {
    expect(paths).not.toHaveProperty('teamTimePath');
    expect(paths).not.toHaveProperty('teamTimeEntryPath');
  });
});
