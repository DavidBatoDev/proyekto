import { AuthService } from './auth.service';
import type { AuthRepository } from './repositories/auth.repository.interface';
import type { PersonalProjectService } from '../../execution/projects/personal-project.service';
import type { WorkspacesService } from '../../execution/workspaces/workspaces.service';
import type { EmailOtpService } from './email-otp.service';
import type { AuthProfile } from './repositories/auth.repository.interface';

function buildProfile(overrides: Partial<AuthProfile> = {}): AuthProfile {
  return {
    id: 'user-1',
    email: 'a@b.com',
    display_name: 'A',
    avatar_url: null,
    consultant_status: null,
    talent_status: null,
    is_consultant_verified: false,
    is_public: false,
    bio: null,
    has_completed_onboarding: true,
    is_email_verified: true,
    settings: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as AuthProfile;
}

function buildService(
  repoOverrides: Partial<AuthRepository>,
  personalProjectOverrides: Partial<PersonalProjectService> = {},
  workspaceOverrides: Partial<WorkspacesService> = {},
) {
  const repo = repoOverrides as AuthRepository;
  const callOrder: string[] = [];

  const provisionPersonalProject = jest.fn().mockImplementation(() => {
    callOrder.push('personal-project');
    return Promise.resolve({
      id: 'proj-1',
      title: "A's Space",
      owner_id: 'user-1',
      status: 'active',
    });
  });
  const personalProjectService = {
    provision: provisionPersonalProject,
    findForUser: jest.fn(),
    ...personalProjectOverrides,
  } as unknown as PersonalProjectService;

  const provisionDefaultWorkspace = jest.fn().mockImplementation(() => {
    callOrder.push('workspace');
    return Promise.resolve({ id: 'ws-1', name: "A's Workspace" });
  });
  const workspacesService = {
    provisionDefault: provisionDefaultWorkspace,
    ...workspaceOverrides,
  } as unknown as WorkspacesService;

  const emailOtpService = {
    requestEmailVerification: jest.fn(),
    confirmEmailVerification: jest.fn(),
    requestPasswordReset: jest.fn(),
    confirmPasswordReset: jest.fn(),
  } as unknown as EmailOtpService;

  return {
    service: new AuthService(
      repo,
      personalProjectService,
      workspacesService,
      emailOtpService,
    ),
    provisionPersonalProject,
    provisionDefaultWorkspace,
    callOrder,
  };
}

describe('AuthService.completeOnboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('provisions both a workspace and a personal project for every user', async () => {
    const completeOnboarding = jest
      .fn<Promise<AuthProfile>, [string]>()
      .mockResolvedValue(buildProfile());

    const { service, provisionPersonalProject, provisionDefaultWorkspace } =
      buildService({ completeOnboarding });

    const result = await service.completeOnboarding('user-1');

    expect(completeOnboarding).toHaveBeenCalledWith('user-1');
    expect(provisionDefaultWorkspace).toHaveBeenCalledWith('user-1');
    expect(provisionPersonalProject).toHaveBeenCalledWith('user-1');
    expect(result.workspace_id).toBe('ws-1');
    expect(result.personal_project_id).toBe('proj-1');
    expect(result.personal_team_id).toBeNull();
  });

  /**
   * Order is load-bearing, not incidental: provision_personal_project stamps
   * the personal project into the caller's default workspace, so a workspace
   * created afterwards would leave that project unhomed on first signup.
   */
  it('provisions the workspace before the personal project', async () => {
    const completeOnboarding = jest
      .fn<Promise<AuthProfile>, [string]>()
      .mockResolvedValue(buildProfile());

    const { service, callOrder } = buildService({ completeOnboarding });
    await service.completeOnboarding('user-1');

    expect(callOrder).toEqual(['workspace', 'personal-project']);
  });

  /**
   * The web app running the previous bundle still reads personal_workspace_id.
   * It must keep resolving to the personal project, not to the new org tier.
   */
  it('keeps personal_workspace_id as an alias of the personal project', async () => {
    const completeOnboarding = jest
      .fn<Promise<AuthProfile>, [string]>()
      .mockResolvedValue(buildProfile());

    const { service } = buildService({ completeOnboarding });
    const result = await service.completeOnboarding('user-1');

    expect(result.personal_workspace_id).toBe('proj-1');
    expect(result.personal_workspace_id).not.toBe(result.workspace_id);
  });

  it('provisions for a verified consultant too (no team at signup)', async () => {
    const completeOnboarding = jest
      .fn<Promise<AuthProfile>, [string]>()
      .mockResolvedValue(
        buildProfile({
          consultant_status: 'verified',
          is_consultant_verified: true,
        }),
      );

    const { service, provisionDefaultWorkspace } = buildService({
      completeOnboarding,
    });

    const result = await service.completeOnboarding('user-1');

    expect(provisionDefaultWorkspace).toHaveBeenCalledWith('user-1');
    expect(result.personal_team_id).toBeNull();
  });

  it('surfaces a personal-project provisioning failure', async () => {
    const completeOnboarding = jest
      .fn<Promise<AuthProfile>, [string]>()
      .mockResolvedValue(buildProfile());
    const provision = jest
      .fn()
      .mockRejectedValue(new Error('partial unique violation outside race'));

    const { service } = buildService({ completeOnboarding }, {
      provision,
    } as Partial<PersonalProjectService>);

    await expect(service.completeOnboarding('user-1')).rejects.toThrow(
      'partial unique violation outside race',
    );
  });

  it('surfaces a workspace provisioning failure without provisioning further', async () => {
    const completeOnboarding = jest
      .fn<Promise<AuthProfile>, [string]>()
      .mockResolvedValue(buildProfile());
    const provisionDefault = jest
      .fn()
      .mockRejectedValue(new Error('workspace rpc unavailable'));

    const { service, provisionPersonalProject } = buildService(
      { completeOnboarding },
      {},
      { provisionDefault } as Partial<WorkspacesService>,
    );

    await expect(service.completeOnboarding('user-1')).rejects.toThrow(
      'workspace rpc unavailable',
    );
    expect(provisionPersonalProject).not.toHaveBeenCalled();
  });
});
