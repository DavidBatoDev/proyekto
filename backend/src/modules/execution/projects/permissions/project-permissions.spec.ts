import { resolvePermissions } from './project-permissions';

describe('project permission origin deltas', () => {
  it('removes team-wide time visibility from client admins', () => {
    const permissions = resolvePermissions('admin', 'client', null);

    expect(permissions.access.time).toBe(true);
    expect(permissions.time.view_team_logs).toBe(false);
  });

  it('keeps explicit capability overrides as the final layer', () => {
    const permissions = resolvePermissions('admin', 'client', {
      'time.view_team_logs': true,
    });

    expect(permissions.time.view_team_logs).toBe(true);
  });
});
