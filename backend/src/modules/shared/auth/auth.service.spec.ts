import { AuthService } from './auth.service';
import type { AuthRepository } from './repositories/auth.repository.interface';
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
  workspaceOverrides: Partial<WorkspacesService> = {},
) {
  const repo = repoOverrides as AuthRepository;

  const provisionDefaultWorkspace = jest
    .fn()
    .mockResolvedValue({ id: 'ws-1', name: "A's Workspace" });
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
    service: new AuthService(repo, workspacesService, emailOtpService),
    provisionDefaultWorkspace,
  };
}

describe('AuthService.completeOnboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('provisions a workspace for every user', async () => {
    const completeOnboarding = jest
      .fn<Promise<AuthProfile>, [string]>()
      .mockResolvedValue(buildProfile());

    const { service, provisionDefaultWorkspace } = buildService({
      completeOnboarding,
    });

    const result = await service.completeOnboarding('user-1');

    expect(completeOnboarding).toHaveBeenCalledWith('user-1');
    expect(provisionDefaultWorkspace).toHaveBeenCalledWith('user-1');
    expect(result.workspace_id).toBe('ws-1');
  });

  /**
   * The regression this file exists to hold down: signup used to create a
   * personal project ("X's Space") for every new user. It must not create any
   * project now — the workspace is the only thing provisioned, and the three
   * legacy id fields are null rather than absent so an older bundle still
   * parses the response.
   */
  it('creates no project at signup', async () => {
    const completeOnboarding = jest
      .fn<Promise<AuthProfile>, [string]>()
      .mockResolvedValue(buildProfile());

    const { service } = buildService({ completeOnboarding });
    const result = await service.completeOnboarding('user-1');

    expect(result.personal_project_id).toBeNull();
    expect(result.personal_workspace_id).toBeNull();
    expect(result.personal_team_id).toBeNull();
    expect(result).toHaveProperty('personal_project_id');
  });

  it('provisions for a verified consultant too (no project, no team)', async () => {
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
    expect(result.personal_project_id).toBeNull();
    expect(result.personal_team_id).toBeNull();
  });

  it('surfaces a workspace provisioning failure', async () => {
    const completeOnboarding = jest
      .fn<Promise<AuthProfile>, [string]>()
      .mockResolvedValue(buildProfile());
    const provisionDefault = jest
      .fn()
      .mockRejectedValue(new Error('workspace rpc unavailable'));

    const { service } = buildService({ completeOnboarding }, {
      provisionDefault,
    } as Partial<WorkspacesService>);

    await expect(service.completeOnboarding('user-1')).rejects.toThrow(
      'workspace rpc unavailable',
    );
  });
});
