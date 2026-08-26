import type { SupabaseClient } from '@supabase/supabase-js';
import { TeamFinanceAccessService } from './team-finance-access.service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';

const projectRow = {
  id: PROJECT_ID,
  title: 'Alpha',
  status: 'active',
  currency: 'PHP',
  owner_id: 'owner-1',
  created_at: '2026-08-01T00:00:00.000Z',
};

/**
 * Table-keyed stub. Each entry is what a terminal await of that table's query
 * resolves to; `counts` feed the head-count queries (`teams` ownership and
 * `team_members` admin checks).
 */
function fakeSupabase(input: {
  ownerCount?: number;
  adminCount?: number;
  accessRows?: Array<{
    project_id: string;
    role: string;
    capabilities: Record<string, unknown> | null;
  }>;
  projectTeams?: Array<{ team_id: string; project_id: string }>;
  project?: typeof projectRow | null;
}): SupabaseClient {
  return {
    from(table: string) {
      let head = false;
      const builder = {
        select(_columns: string, options?: { head?: boolean }) {
          head = options?.head === true;
          return builder;
        },
        eq() {
          return builder;
        },
        in() {
          return builder;
        },
        ilike() {
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({
            data: input.project === undefined ? projectRow : input.project,
            error: null,
          });
        },
        then(resolve: (value: unknown) => unknown) {
          if (head) {
            const count =
              table === 'teams'
                ? (input.ownerCount ?? 0)
                : (input.adminCount ?? 0);
            return Promise.resolve({ data: null, error: null, count }).then(
              resolve,
            );
          }
          const data =
            table === 'project_access'
              ? (input.accessRows ?? [])
              : table === 'project_teams'
                ? (input.projectTeams ?? [])
                : table === 'projects'
                  ? [projectRow]
                  : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const consultantAccessDenied = {
  assertProject: jest.fn().mockRejectedValue(new Error('not the consultant')),
};

describe('TeamFinanceAccessService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('assertProjectFinanceActor', () => {
    it('passes through the consultant+owner branch untouched', async () => {
      const consultantAccess = {
        assertProject: jest.fn().mockResolvedValue(projectRow),
      };
      const projectAuth = { assertPermission: jest.fn() };
      const service = new TeamFinanceAccessService(
        fakeSupabase({}),
        projectAuth as never,
        consultantAccess as never,
      );

      await expect(
        service.assertProjectFinanceActor('caller-1', PROJECT_ID, 'manage'),
      ).resolves.toEqual(projectRow);
      expect(projectAuth.assertPermission).not.toHaveBeenCalled();
    });

    it('falls back to finance.view for reads', async () => {
      const projectAuth = { assertPermission: jest.fn().mockResolvedValue({}) };
      const service = new TeamFinanceAccessService(
        fakeSupabase({}),
        projectAuth as never,
        consultantAccessDenied as never,
      );

      await expect(
        service.assertProjectFinanceActor('admin-1', PROJECT_ID, 'read'),
      ).resolves.toEqual(projectRow);
      expect(projectAuth.assertPermission).toHaveBeenCalledWith(
        'admin-1',
        PROJECT_ID,
        'finance.view',
      );
    });

    it('requires finance.manage_invoices for mutations', async () => {
      const projectAuth = {
        assertPermission: jest.fn().mockRejectedValue(new Error('missing')),
      };
      const service = new TeamFinanceAccessService(
        fakeSupabase({}),
        projectAuth as never,
        consultantAccessDenied as never,
      );

      await expect(
        service.assertProjectFinanceActor('viewer-1', PROJECT_ID, 'manage'),
      ).rejects.toThrow('missing');
      expect(projectAuth.assertPermission).toHaveBeenCalledWith(
        'viewer-1',
        PROJECT_ID,
        'finance.manage_invoices',
      );
    });
  });

  describe('listTeamProjects', () => {
    it('refuses a caller who does not administer the team', async () => {
      const service = new TeamFinanceAccessService(
        fakeSupabase({ ownerCount: 0, adminCount: 0 }),
        { assertPermission: jest.fn() } as never,
        consultantAccessDenied as never,
      );

      await expect(
        service.listTeamProjects('stranger', TEAM_ID),
      ).rejects.toThrow('Team finance not found');
    });

    it('keeps only attached projects whose access row resolves finance.view', async () => {
      // An admin access row resolves finance.view by baseline; a viewer row
      // does not — so only the admin project survives the filter.
      const service = new TeamFinanceAccessService(
        fakeSupabase({
          adminCount: 1,
          projectTeams: [
            { team_id: TEAM_ID, project_id: PROJECT_ID },
            { team_id: TEAM_ID, project_id: 'viewer-project' },
          ],
          accessRows: [
            { project_id: PROJECT_ID, role: 'admin', capabilities: null },
            { project_id: 'viewer-project', role: 'viewer', capabilities: null },
          ],
        }),
        { assertPermission: jest.fn() } as never,
        consultantAccessDenied as never,
      );

      await expect(
        service.listTeamProjects('admin-1', TEAM_ID),
      ).resolves.toEqual([projectRow]);
    });

    it('honours a per-member capability deny', async () => {
      const service = new TeamFinanceAccessService(
        fakeSupabase({
          adminCount: 1,
          projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
          accessRows: [
            {
              project_id: PROJECT_ID,
              role: 'admin',
              capabilities: { 'finance.view': false },
            },
          ],
        }),
        { assertPermission: jest.fn() } as never,
        consultantAccessDenied as never,
      );

      await expect(
        service.listTeamProjects('admin-1', TEAM_ID),
      ).resolves.toEqual([]);
    });

    it('honours a contracts-only deny when scoped by finance.view_contracts', async () => {
      // `finance.view_contracts` implies `finance.view` but can be denied on
      // its own. The contract listing asks for the narrower capability, so a
      // project the member may still see money for drops out of it — the team
      // route must not be the way around a deny the single-project route
      // already honours.
      const supabase = fakeSupabase({
        adminCount: 1,
        projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
        accessRows: [
          {
            project_id: PROJECT_ID,
            role: 'admin',
            capabilities: { 'finance.view_contracts': false },
          },
        ],
      });
      const service = new TeamFinanceAccessService(
        supabase,
        { assertPermission: jest.fn() } as never,
        consultantAccessDenied as never,
      );

      await expect(
        service.listTeamProjects('admin-1', TEAM_ID, {}, 'finance.view'),
      ).resolves.toEqual([projectRow]);
      await expect(
        service.listTeamProjects(
          'admin-1',
          TEAM_ID,
          {},
          'finance.view_contracts',
        ),
      ).resolves.toEqual([]);
    });
  });
});
