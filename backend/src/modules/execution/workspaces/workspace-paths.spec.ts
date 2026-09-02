import { teamTimePath } from './workspace-paths';

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
