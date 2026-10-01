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

  describe('assertProjectFinanceActor via a team finance-book role', () => {
    const refused = () =>
      Object.assign(new Error('missing finance.view'), { status: 403 });
    const projectAuthRefusing = () => ({
      assertPermission: jest.fn().mockRejectedValue(refused()),
    });
    const bookRole = (role: string, permissions: Record<string, boolean>) => ({
      resolveAccess: jest.fn().mockResolvedValue({ role, permissions }),
    });

    it('lets an accountant with no project_access read an attached project', async () => {
      const service = new TeamFinanceAccessService(
        fakeSupabase({
          projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
          accessRows: [],
        }),
        projectAuthRefusing() as never,
        consultantAccessDenied as never,
        bookRole('accountant', {
          view_contracts: true,
          manage_money: false,
        }) as never,
      );

      await expect(
        service.assertProjectFinanceActor('accountant-1', PROJECT_ID, 'read'),
      ).resolves.toEqual(projectRow);
    });

    it('does not let that accountant manage (no manage_money)', async () => {
      const service = new TeamFinanceAccessService(
        fakeSupabase({
          projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
        }),
        projectAuthRefusing() as never,
        consultantAccessDenied as never,
        bookRole('accountant', {
          view_contracts: true,
          manage_money: false,
        }) as never,
      );

      await expect(
        service.assertProjectFinanceActor('accountant-1', PROJECT_ID, 'manage'),
      ).rejects.toThrow('missing finance.view');
    });

    it('refuses the accountant on a project not attached to any team', async () => {
      const bookAccess = bookRole('accountant', {
        view_contracts: true,
        manage_money: false,
      });
      const service = new TeamFinanceAccessService(
        fakeSupabase({ projectTeams: [] }),
        projectAuthRefusing() as never,
        consultantAccessDenied as never,
        bookAccess as never,
      );

      await expect(
        service.assertProjectFinanceActor('accountant-1', PROJECT_ID, 'read'),
      ).rejects.toThrow('missing finance.view');
      expect(bookAccess.resolveAccess).not.toHaveBeenCalled();
    });

    it('lets a book manager manage an attached project', async () => {
      const service = new TeamFinanceAccessService(
        fakeSupabase({
          projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
        }),
        projectAuthRefusing() as never,
        consultantAccessDenied as never,
        bookRole('manager', {
          view_contracts: true,
          manage_money: true,
        }) as never,
      );

      await expect(
        service.assertProjectFinanceActor('manager-1', PROJECT_ID, 'manage'),
      ).resolves.toEqual(projectRow);
    });

    it('refuses a client viewer on the team book, keeping the 403', async () => {
      const service = new TeamFinanceAccessService(
        fakeSupabase({
          projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
        }),
        projectAuthRefusing() as never,
        consultantAccessDenied as never,
        bookRole('viewer_client', {
          view_contracts: true,
          manage_money: false,
        }) as never,
      );

      await expect(
        service.assertProjectFinanceActor('client-1', PROJECT_ID, 'read'),
      ).rejects.toMatchObject({ status: 403 });
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
            {
              project_id: 'viewer-project',
              role: 'viewer',
              capabilities: null,
            },
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

  describe('listTeamProjects via a team finance-book role', () => {
    const bookAccessFor = (permissions: Record<string, boolean> | null) => ({
      resolveAccess: jest
        .fn()
        .mockResolvedValue(
          permissions ? { role: 'accountant', permissions } : null,
        ),
    });

    it('lets a book accountant who is not a team admin see every attached project', async () => {
      const bookAccess = bookAccessFor({ view: true, view_contracts: true });
      const service = new TeamFinanceAccessService(
        fakeSupabase({
          ownerCount: 0,
          adminCount: 0,
          projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
          // No project_access rows at all: finance roles never grant execution.
          accessRows: [],
        }),
        { assertPermission: jest.fn() } as never,
        consultantAccessDenied as never,
        bookAccess as never,
      );

      await expect(
        service.listTeamProjects('accountant-1', TEAM_ID),
      ).resolves.toEqual([projectRow]);
      await expect(
        service.listTeamProjects(
          'accountant-1',
          TEAM_ID,
          {},
          'finance.view_contracts',
        ),
      ).resolves.toEqual([projectRow]);
      expect(bookAccess.resolveAccess).toHaveBeenCalledWith(
        'accountant-1',
        PROJECT_ID, // the fake returns this id for the team-book lookup
      );
    });

    it('refuses a book role without view_contracts', async () => {
      const service = new TeamFinanceAccessService(
        fakeSupabase({
          projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
        }),
        { assertPermission: jest.fn() } as never,
        consultantAccessDenied as never,
        bookAccessFor({ view: true, view_contracts: false }) as never,
      );

      await expect(
        service.listTeamProjects(
          'viewer-1',
          TEAM_ID,
          {},
          'finance.view_contracts',
        ),
      ).rejects.toThrow('Team finance not found');
    });

    it('refuses a caller with no role on the team book', async () => {
      const service = new TeamFinanceAccessService(
        fakeSupabase({}),
        { assertPermission: jest.fn() } as never,
        consultantAccessDenied as never,
        bookAccessFor(null) as never,
      );

      await expect(
        service.listTeamProjects('stranger', TEAM_ID),
      ).rejects.toThrow('Team finance not found');
    });

    it('maps finance.manage_invoices to the manage_money book capability', async () => {
      const service = new TeamFinanceAccessService(
        fakeSupabase({
          projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
        }),
        { assertPermission: jest.fn() } as never,
        consultantAccessDenied as never,
        bookAccessFor({ view_contracts: true, manage_money: false }) as never,
      );

      await expect(
        service.listTeamProjects(
          'accountant-1',
          TEAM_ID,
          {},
          'finance.manage_invoices',
        ),
      ).rejects.toThrow('Team finance not found');
    });

    it('does not consult the book for a team administrator', async () => {
      const bookAccess = bookAccessFor({ view_contracts: true });
      const service = new TeamFinanceAccessService(
        fakeSupabase({
          adminCount: 1,
          projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
          accessRows: [
            { project_id: PROJECT_ID, role: 'admin', capabilities: null },
          ],
        }),
        { assertPermission: jest.fn() } as never,
        consultantAccessDenied as never,
        bookAccess as never,
      );

      await expect(
        service.listTeamProjects('admin-1', TEAM_ID),
      ).resolves.toEqual([projectRow]);
      expect(bookAccess.resolveAccess).not.toHaveBeenCalled();
    });
  });

  describe('listProjectFinanceAccess', () => {
    const financeProject = {
      id: PROJECT_ID,
      title: 'Alpha',
      status: 'active',
      currency: 'PHP',
    };
    const serviceFor = (input: Parameters<typeof fakeSupabase>[0]) =>
      new TeamFinanceAccessService(
        fakeSupabase(input),
        { assertPermission: jest.fn() } as never,
        consultantAccessDenied as never,
      );

    it('leaves out a project where a team admin is only an editor', async () => {
      // The PROD report: team admin, project editor. Editors do not hold
      // finance.view, so the project-scoped endpoints refuse them — and the
      // picker must not offer the project in the first place.
      const service = serviceFor({
        adminCount: 1,
        projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
        accessRows: [
          { project_id: PROJECT_ID, role: 'editor', capabilities: null },
        ],
      });

      await expect(
        service.listProjectFinanceAccess('admin-1', TEAM_ID),
      ).resolves.toEqual([]);
    });

    it('lists a project the caller administers, with manage rights', async () => {
      const service = serviceFor({
        projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
        accessRows: [
          { project_id: PROJECT_ID, role: 'admin', capabilities: null },
        ],
      });

      await expect(
        service.listProjectFinanceAccess('admin-1', TEAM_ID),
      ).resolves.toEqual([{ ...financeProject, can_manage_invoices: true }]);
    });

    it('reports read-only access when invoice management is denied', async () => {
      const service = serviceFor({
        projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
        accessRows: [
          {
            project_id: PROJECT_ID,
            role: 'admin',
            capabilities: { 'finance.manage_invoices': false },
          },
        ],
      });

      await expect(
        service.listProjectFinanceAccess('admin-1', TEAM_ID),
      ).resolves.toEqual([{ ...financeProject, can_manage_invoices: false }]);
    });

    it('unions several access rows on one project, like the project gate', async () => {
      const service = serviceFor({
        projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
        accessRows: [
          { project_id: PROJECT_ID, role: 'admin', capabilities: null },
          {
            project_id: PROJECT_ID,
            role: 'admin',
            capabilities: { 'finance.manage_invoices': false },
          },
        ],
      });

      await expect(
        service.listProjectFinanceAccess('admin-1', TEAM_ID),
      ).resolves.toEqual([{ ...financeProject, can_manage_invoices: true }]);
    });

    const bookRole = (role: string, permissions: Record<string, boolean>) => ({
      resolveAccess: jest.fn().mockResolvedValue({ role, permissions }),
    });
    const serviceWithBook = (
      bookAccess: unknown,
      input: Parameters<typeof fakeSupabase>[0],
    ) =>
      new TeamFinanceAccessService(
        fakeSupabase(input),
        { assertPermission: jest.fn() } as never,
        consultantAccessDenied as never,
        bookAccess as never,
      );

    it('admits every attached project to a team book manager, with manage rights', async () => {
      const service = serviceWithBook(
        bookRole('manager', { view_contracts: true, manage_money: true }),
        {
          projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
          accessRows: [],
        },
      );

      await expect(
        service.listProjectFinanceAccess('manager-1', TEAM_ID),
      ).resolves.toEqual([{ ...financeProject, can_manage_invoices: true }]);
    });

    it('admits an accountant read-only', async () => {
      const service = serviceWithBook(
        bookRole('accountant', { view_contracts: true, manage_money: false }),
        {
          projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
          accessRows: [],
        },
      );

      await expect(
        service.listProjectFinanceAccess('accountant-1', TEAM_ID),
      ).resolves.toEqual([{ ...financeProject, can_manage_invoices: false }]);
    });

    it('never admits a client viewer on the team book', async () => {
      const service = serviceWithBook(
        bookRole('viewer_client', {
          view_contracts: true,
          manage_money: false,
        }),
        {
          projectTeams: [{ team_id: TEAM_ID, project_id: PROJECT_ID }],
          accessRows: [],
        },
      );

      await expect(
        service.listProjectFinanceAccess('client-1', TEAM_ID),
      ).resolves.toEqual([]);
    });

    it('answers a stranger or an unknown team with an empty list, not an error', async () => {
      const service = serviceFor({ projectTeams: [] });

      await expect(
        service.listProjectFinanceAccess('stranger', TEAM_ID),
      ).resolves.toEqual([]);
    });
  });
});
