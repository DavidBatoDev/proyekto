import { PersonalWorkspaceService } from './personal-workspace.service';

/**
 * Builds a minimal Supabase client double whose `.from(table)` returns
 * a chainable query builder driven by per-call handlers.
 *
 * Each test wires up the handlers it needs; unused tables throw on access.
 */
type Handler = jest.Mock;

interface QueryStub {
  select: Handler;
  insert: Handler;
  eq: Handler;
  maybeSingle: Handler;
  single: Handler;
}

function makeQueryStub(): QueryStub {
  const stub: any = {};
  stub.select = jest.fn(() => stub);
  stub.insert = jest.fn(() => stub);
  stub.eq = jest.fn(() => stub);
  stub.maybeSingle = jest.fn();
  stub.single = jest.fn();
  return stub as QueryStub;
}

function buildService(
  tables: Record<string, QueryStub>,
  authorizationOverrides: Partial<Record<string, jest.Mock>> = {},
): PersonalWorkspaceService {
  const supabase: any = {
    from: (table: string) => {
      if (!tables[table]) {
        throw new Error(`Unexpected table access: ${table}`);
      }
      return tables[table];
    },
  };
  // Default authorization stub: grant() succeeds, returns a fake share row.
  const authorization = {
    grant: jest.fn().mockResolvedValue({
      id: 'share-1',
      project_id: 'p',
      user_id: 'u',
      role: 'owner',
      origin: 'personal_workspace',
      capabilities: {},
      granted_by: 'u',
      granted_at: '2026-05-03T00:00:00Z',
    }),
    getUserProjectRole: jest.fn(),
    assertRole: jest.fn(),
    roleSatisfies: jest.fn(),
    revoke: jest.fn(),
    ...authorizationOverrides,
  } as any;
  return new PersonalWorkspaceService(supabase, authorization);
}

describe('PersonalWorkspaceService', () => {
  describe('provision()', () => {
    it('returns the existing workspace when one is already present (idempotent)', async () => {
      const projects = makeQueryStub();
      projects.maybeSingle.mockResolvedValueOnce({
        data: {
          id: 'ws-1',
          title: "Alex's Workspace",
          client_id: 'user-1',
          is_personal_workspace: true,
          status: 'active',
        },
        error: null,
      });

      const service = buildService({ projects });
      const result = await service.provision('user-1');

      expect(result.id).toBe('ws-1');
      expect(projects.insert).not.toHaveBeenCalled();
    });

    it('creates a new workspace and attaches owner member when none exists', async () => {
      const projects = makeQueryStub();
      const profiles = makeQueryStub();
      const projectMembers = makeQueryStub();

      // findExisting -> not found
      projects.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      // buildDefaultTitle -> profile lookup
      profiles.maybeSingle.mockResolvedValueOnce({
        data: { first_name: 'Alex', display_name: null },
        error: null,
      });
      // insert project -> success
      projects.single.mockResolvedValueOnce({
        data: {
          id: 'ws-2',
          title: "Alex's Workspace",
          client_id: 'user-2',
          is_personal_workspace: true,
          status: 'active',
        },
        error: null,
      });
      // attach owner member -> success
      projectMembers.insert.mockReturnValueOnce(
        Promise.resolve({ error: null }) as any,
      );

      const service = buildService({
        projects,
        profiles,
        project_members: projectMembers,
      });
      const result = await service.provision('user-2');

      expect(result.title).toBe("Alex's Workspace");
      expect(projectMembers.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'ws-2',
          user_id: 'user-2',
          permissions_json: { is_owner: true },
        }),
      );
    });

    it('falls back to the surviving row on partial-unique-index race (23505)', async () => {
      const projects = makeQueryStub();
      const profiles = makeQueryStub();

      // First findExisting -> not found
      projects.maybeSingle
        .mockResolvedValueOnce({ data: null, error: null })
        // Second findExisting after race -> the survivor
        .mockResolvedValueOnce({
          data: {
            id: 'ws-3',
            title: "Sam's Workspace",
            client_id: 'user-3',
            is_personal_workspace: true,
            status: 'active',
          },
          error: null,
        });
      profiles.maybeSingle.mockResolvedValueOnce({
        data: { first_name: 'Sam' },
        error: null,
      });
      // Insert -> unique violation
      projects.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      });

      const service = buildService({ projects, profiles });
      const result = await service.provision('user-3');

      expect(result.id).toBe('ws-3');
    });

    it("falls back to 'My' when neither first_name nor display_name is set", async () => {
      const projects = makeQueryStub();
      const profiles = makeQueryStub();
      const projectMembers = makeQueryStub();

      projects.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      profiles.maybeSingle.mockResolvedValueOnce({
        data: { first_name: null, display_name: null },
        error: null,
      });
      projects.single.mockResolvedValueOnce({
        data: {
          id: 'ws-4',
          title: "My's Workspace",
          client_id: 'user-4',
          is_personal_workspace: true,
          status: 'active',
        },
        error: null,
      });
      projectMembers.insert.mockReturnValueOnce(
        Promise.resolve({ error: null }) as any,
      );

      const service = buildService({
        projects,
        profiles,
        project_members: projectMembers,
      });

      await service.provision('user-4');

      // Verify the title written to the insert payload
      const insertCall = projects.insert.mock.calls[0][0];
      expect(insertCall.title).toBe("My's Workspace");
    });
  });

  describe('findForUser()', () => {
    it('returns null when the user has no workspace', async () => {
      const projects = makeQueryStub();
      projects.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

      const service = buildService({ projects });
      const result = await service.findForUser('user-x');

      expect(result).toBeNull();
    });
  });
});
