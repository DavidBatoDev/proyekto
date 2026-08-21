import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import type { ProjectsRepository } from './repositories/projects.repository.interface';
import type { Project } from '../../../common/entities';

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    title: 'Project One',
    status: 'draft',
    owner_id: 'client-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('ProjectsService (permissions)', () => {
  const notificationsService = {
    createNotification: jest.fn(),
  };
  const dataCache = {
    getAuthTtlSeconds: jest.fn().mockReturnValue(45),
    getDashboardTtlSeconds: jest.fn().mockReturnValue(45),
    rememberJson: jest.fn((_key: string, _ttl: number, loader: any) =>
      loader(),
    ),
  };
  const cacheInvalidation = {
    invalidateAllDashboardCache: jest.fn().mockResolvedValue(undefined),
  };

  // Default authorization stub: caller has no project_shares grant. Tests
  // that exercise the role-based bypass should override `getUserProjectRole`.
  const defaultAuthorization = {
    getUserProjectRole: jest.fn().mockResolvedValue(null),
    assertRole: jest.fn(),
    assertPermission: jest.fn(),
    assertActionOutranks: jest.fn().mockResolvedValue(undefined),
    resolvePermissions: jest.fn(),
    roleSatisfies: jest.fn(),
    listUsersWithPermission: jest.fn().mockResolvedValue(['manager-1']),
    grant: jest.fn(),
    revoke: jest.fn(),
  };

  /**
   * A chainable no-op Supabase stub: every table reads back empty.
   *
   * `{ from: jest.fn() }` returned undefined, so any code path that grew a new
   * query — the invite path picked up a suppression-list check — died on
   * `.select` of undefined rather than failing on the behaviour under test.
   * Tests that care about a specific table pass their own stub.
   */
  const inertSupabase = () => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  });

  const buildService = (
    repoOverrides: Partial<ProjectsRepository>,
    authorizationOverrides: Partial<typeof defaultAuthorization> = {},
    supabaseStub: unknown = inertSupabase(),
  ) => {
    const repo = repoOverrides as ProjectsRepository;
    const authorization = {
      ...defaultAuthorization,
      ...authorizationOverrides,
    };
    const projectTeams = {
      attach: jest.fn(),
      detach: jest.fn(),
      list: jest.fn(),
    } as any;
    const accessSync = {
      syncUser: jest.fn().mockResolvedValue(null),
      setUserRole: jest.fn().mockResolvedValue(null),
      setUserCapabilities: jest.fn().mockResolvedValue(undefined),
      setUserCapabilitiesByMemberId: jest.fn().mockResolvedValue(null),
    } as any;
    return new ProjectsService(
      repo,
      notificationsService as any,
      authorization as any,
      projectTeams,
      accessSync,
      supabaseStub as any,
      dataCache as any,
      cacheInvalidation as any,
      { get: jest.fn() } as any,
      {
        provisionDefaultChannels: jest.fn().mockResolvedValue(undefined),
      } as any,
      { send: jest.fn().mockResolvedValue({ sent: true }) } as any,
      { log: jest.fn() } as any, // AuditService
      { stopRunningLogsForProject: jest.fn() } as any,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates execution status without commercial prerequisites', async () => {
    const activeProject = buildProject({ status: 'active' });
    const repo = {
      isOwner: jest.fn().mockResolvedValue(true),
      update: jest.fn().mockResolvedValue(activeProject),
    };
    const service = buildService(repo);

    await expect(
      service.updateProject('project-1', 'client-1', { status: 'active' }),
    ).resolves.toEqual(activeProject);
    expect(repo.update).toHaveBeenCalledWith('project-1', {
      status: 'active',
    });
  });

  it('uses user-scoped dashboard cache keys', async () => {
    const repo = {
      findDashboardByUser: jest.fn().mockResolvedValue([]),
    };
    const service = buildService(repo);

    await service.listDashboardProjects('user-a');
    await service.listDashboardProjects('user-b');

    expect(dataCache.rememberJson).toHaveBeenCalledWith(
      'cache:v1:projects:dashboard:user:user-a',
      expect.any(Number),
      expect.any(Function),
      expect.objectContaining({
        indexKey: 'cache:v1:index:projects:dashboard',
      }),
    );
    expect(dataCache.rememberJson).toHaveBeenCalledWith(
      'cache:v1:projects:dashboard:user:user-b',
      expect.any(Number),
      expect.any(Function),
      expect.objectContaining({
        indexKey: 'cache:v1:index:projects:dashboard',
      }),
    );
  });

  // Tech-debt cleanup: legacy member-template behavior is gone. The
  // synthesized-permissions test below covers the equivalent behavior
  // (an editor sees view=true, manage=false on members).

  it('resolves role+origin+capabilities permissions for getMyPermissions', async () => {
    // getMyPermissions now resolves the share row through the layered
    // resolver. An editor with no capability overrides sees view=true,
    // manage=false on members.
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'editor',
        origin: 'invited',
        position: null,
        capabilities: {},
      }),
    };
    const service = buildService(repo);

    const result = await service.getMyPermissions('project-1', 'member-1');

    expect(result.members.manage).toBe(false);
    expect(result.members.view).toBe(true);
    expect(result.roadmap.edit).toBe(true);
  });

  // The origin used to add an "operator toolkit" on top of the role — an editor
  // with a consultant origin silently gained members.manage. Permissions now come
  // from the rung and the per-member capabilities only, so how the member joined
  // makes no difference to what they can do.
  it('ignores the access origin when resolving permissions', async () => {
    const forOrigin = async (origin: string) => {
      const repo = {
        findById: jest.fn().mockResolvedValue(buildProject()),
        getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
          id: 'member-row-1',
          user_id: 'member-1',
          role: 'editor',
          origin,
          position: 'Lead',
          capabilities: {},
        }),
      };
      return buildService(repo).getMyPermissions('project-1', 'member-1');
    };

    const asConsultant = await forOrigin('consultant');
    const asClient = await forOrigin('client');
    const asInvited = await forOrigin('invited');

    expect(asConsultant).toEqual(asInvited);
    expect(asClient).toEqual(asInvited);
    // An editor does not manage members whatever label their row carries.
    expect(asConsultant.members.manage).toBe(false);
  });

  it('applies capabilities overrides on top of (role, origin) baseline', async () => {
    // Viewer with explicit overrides: roadmap.view + roadmap.edit + access.roadmap
    // all true → resolved permissions show roadmap.edit true.
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'viewer',
        origin: 'invited',
        position: null,
        capabilities: {
          'roadmap.edit': true,
        },
      }),
    };
    const service = buildService(repo);

    const result = await service.getMyPermissions('project-1', 'member-1');

    expect(result.roadmap.edit).toBe(true);
    // Roadmap.view is still true from the viewer baseline (deps satisfied).
    expect(result.roadmap.view).toBe(true);
  });

  it('rejects permission updates when caller lacks members.edit_permissions', async () => {
    // The capability gate is members.edit_permissions, default-granted at
    // admin+. An editor (or lower) without the override gets a Forbidden.
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
    };
    const service = buildService(repo, {
      assertPermission: jest
        .fn()
        .mockRejectedValue(
          new ForbiddenException('Missing required permission'),
        ),
    });

    await expect(
      service.updateMemberPermissions('project-1', 'member-row-1', 'client-1', {
        roadmap: {
          edit: true,
          comment: true,
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows permission updates when caller has members.edit_permissions', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberById: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'editor',
        origin: 'invited',
        position: null,
        capabilities: {},
      }),
      updateMemberCapabilities: jest.fn().mockResolvedValue({ ok: true }),
    };
    const service = buildService(repo, {
      assertPermission: jest.fn().mockResolvedValue({}),
    });

    await expect(
      service.updateMemberPermissions(
        'project-1',
        'member-row-1',
        'consultant-1',
        {
          roadmap: {
            view: true,
            edit: true,
            comment: true,
            promote: true,
          },
          access: { roadmap: true },
        },
      ),
    ).resolves.toEqual({ ok: true });
    expect(repo.updateMemberCapabilities).toHaveBeenCalled();
  });

  /**
   * The delivery-governance sections must be writable.
   *
   * They were missing from `UpdateProjectMemberPermissionsDto` and from the
   * `sections` array, which broke the editor completely: it posts back the whole
   * object returned by `GET .../permissions`, and the global pipe runs
   * `forbidNonWhitelisted`, so every save 400'd on "property deliverables should
   * not exist". Nothing covered it. They matter more now that the role ladder and
   * capabilities are the only sources — withholding internal risks from one member
   * is only possible if this path works.
   */
  it('persists the delivery-governance sections', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberById: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'admin',
        origin: 'invited',
        position: null,
        capabilities: {},
      }),
      updateMemberCapabilities: jest.fn().mockResolvedValue({ ok: true }),
    };
    const service = buildService(repo, {
      assertPermission: jest.fn().mockResolvedValue({}),
    });

    await expect(
      service.updateMemberPermissions('project-1', 'member-row-1', 'admin-1', {
        access: { delivery: true },
        // An admin holds these by default, so denying them is the interesting
        // case — it is the replacement for what the client origin delta did.
        risks: { view_internal: false },
        decisions: { view_internal: false },
        deliverables: { approve: false },
      }),
    ).resolves.toEqual({ ok: true });

    const written = repo.updateMemberCapabilities.mock.calls[0];
    expect(written).toBeDefined();
    // The stored delta records the denials, since the admin baseline grants them.
    expect(JSON.stringify(written)).toContain('risks.view_internal');
  });

  it('rejects permission updates that violate dependencies', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberById: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'viewer',
        origin: 'invited',
        position: null,
        capabilities: {},
      }),
      updateMemberCapabilities: jest.fn(),
    };
    const service = buildService(repo, {
      assertPermission: jest.fn().mockResolvedValue({}),
    });

    // Trying to grant roadmap.edit while turning off roadmap.view (and
    // access.roadmap) should fail dependency validation.
    await expect(
      service.updateMemberPermissions(
        'project-1',
        'member-row-1',
        'consultant-1',
        {
          access: { roadmap: false },
          roadmap: { view: false, edit: true },
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateMemberCapabilities).not.toHaveBeenCalled();
  });

  it('notifies members.manage holders when an admin invites someone', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue(null),
      inviteByEmail: jest.fn().mockResolvedValue({
        id: 'invite-1',
        invitee_id: null,
        invited_position: 'Backend Developer',
      }),
      getInviterProfile: jest.fn().mockResolvedValue({
        displayName: 'Client Owner',
        avatarUrl: null,
      }),
      getProfileDisplayName: jest.fn().mockResolvedValue('Client Owner'),
    };
    // Post-refactor: client has admin role on the project (granted at
    // project create time). The role bypass replaces the legacy owner_id
    // === userId check.
    const service = buildService(repo, {
      getUserProjectRole: jest.fn().mockResolvedValue('admin'),
    });

    await service.inviteByEmail('project-1', 'client-1', {
      email: 'talent@example.com',
      position: 'Backend Developer',
    });

    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'manager-1',
        type_name: 'project_updated',
        actor_id: 'client-1',
      }),
    );
  });

  it('unassigns tasks then removes the member, and notifies roster managers', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(buildProject()),
      getMemberByProjectAndUserId: jest.fn().mockResolvedValue(null),
      getMemberById: jest.fn().mockResolvedValue({
        id: 'member-row-1',
        user_id: 'member-1',
        role: 'member',
      }),
      unassignTasksForMemberInProject: jest.fn().mockResolvedValue(3),
      removeMember: jest.fn().mockResolvedValue(undefined),
      getProfileDisplayName: jest.fn().mockResolvedValue('Talent One'),
    };
    const service = buildService(repo, {
      getUserProjectRole: jest.fn().mockResolvedValue('admin'),
    });

    await service.removeMember('project-1', 'member-row-1', 'client-1');

    expect(repo.unassignTasksForMemberInProject).toHaveBeenCalledWith(
      'project-1',
      'member-1',
    );
    expect(repo.removeMember).toHaveBeenCalledWith('project-1', 'member-row-1');
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'manager-1',
        type_name: 'project_updated',
        actor_id: 'client-1',
      }),
    );
  });

  // The six consultant-reassignment cases that were here are gone with the
  // endpoint. They asserted a flow whose whole purpose was moving
  // project_access.origin to consultant: that the caller was owner-or-consultant,
  // that the target was consultant-verified, and that grant ran before revoke.
  // Ownership transfer is the surviving path and keeps its own coverage.


  // ── mention-by-email availability ─────────────────────────────────────────
  describe('mentions.invite_by_email', () => {
    /** Supabase stub serving one notification_types row. */
    const flagDb = (emailEligible: boolean, error = false) => {
      const from = jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({
              data: error ? null : { email_eligible: emailEligible },
              error: error ? { message: 'boom' } : null,
            }),
          })),
        })),
      }));
      return { from };
    };

    const permissionsFor = async (
      role: string,
      opts: {
        flag?: boolean;
        flagError?: boolean;
        capabilities?: Record<string, boolean>;
      } = {},
    ) => {
      const db = flagDb(opts.flag ?? true, opts.flagError);
      const service = buildService(
        {
          findById: jest.fn().mockResolvedValue(buildProject()),
          getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
            id: 'm-1',
            user_id: 'user-1',
            role,
            origin: null,
            position: null,
            capabilities: opts.capabilities ?? {},
          }),
        },
        {},
        db,
      );
      const perms = await service.getMyPermissions('project-1', 'user-1');
      return { perms, db };
    };

    it('is true only for admin-or-stronger with the flag on', async () => {
      const { perms } = await permissionsFor('admin', { flag: true });

      expect(perms.mentions.invite_by_email).toBe(true);
    });

    it('is true for an owner', async () => {
      const { perms } = await permissionsFor('owner', { flag: true });

      expect(perms.mentions.invite_by_email).toBe(true);
    });

    it('is false below admin even with the flag on', async () => {
      for (const role of ['viewer', 'commenter', 'editor']) {
        const { perms } = await permissionsFor(role, { flag: true });
        expect(perms.mentions.invite_by_email).toBe(false);
      }
    });

    it('is false for an admin when the flag is off', async () => {
      const { perms } = await permissionsFor('admin', { flag: false });

      expect(perms.mentions.invite_by_email).toBe(false);
    });

    it('is false for an editor granted members.manage by capability', async () => {
      // The trap this guards: `members.manage` and `roleSatisfies('admin')` can
      // disagree, so using the permission as the predicate would offer the
      // affordance to someone `assertRole('admin')` then refuses — a UI that
      // promises what the server declines.
      //
      // The disagreement used to come from ORIGIN_DELTAS granting members.manage
      // regardless of role. With the origin deltas gone, a per-member capability
      // produces exactly the same divergence, so the guard still earns its place.
      const { perms } = await permissionsFor('editor', {
        flag: true,
        capabilities: { 'members.manage': true },
      });

      expect(perms.members.manage).toBe(true);
      expect(perms.mentions.invite_by_email).toBe(false);
    });

    it('fails closed when the flag cannot be read', async () => {
      const { perms } = await permissionsFor('admin', { flagError: true });

      expect(perms.mentions.invite_by_email).toBe(false);
    });

    it('does not re-read the flag on every call', async () => {
      const db = flagDb(true);
      const service = buildService(
        {
          findById: jest.fn().mockResolvedValue(buildProject()),
          getMemberByProjectAndUserId: jest.fn().mockResolvedValue({
            id: 'm-1',
            user_id: 'user-1',
            role: 'admin',
            origin: null,
            position: null,
            capabilities: {},
          }),
        },
        {},
        db,
      );

      await service.getMyPermissions('project-1', 'user-1');
      await service.getMyPermissions('project-1', 'user-1');
      await service.getMyPermissions('project-1', 'user-1');

      // Memoised: this endpoint is hit per project view.
      expect(db.from).toHaveBeenCalledTimes(1);
    });
  });
});
