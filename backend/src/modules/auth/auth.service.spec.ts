import { AuthService } from './auth.service';
import type { AuthRepository } from './repositories/auth.repository.interface';
import type { PersonalWorkspaceService } from '../projects/personal-workspace.service';
import type { Profile } from '../../common/entities';
import type { EmailOtpService } from './email-otp.service';

function buildProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'user-1',
    email: 'a@b.com',
    display_name: 'A',
    avatar_url: null,
    is_consultant_verified: false,
    bio: null,
    has_completed_onboarding: true,
    is_email_verified: true,
    settings: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Profile;
}

function buildService(
  repoOverrides: Partial<AuthRepository>,
  workspaceOverrides: Partial<PersonalWorkspaceService> = {},
  eligibilityOverrides: { check?: jest.Mock } = {},
) {
  const repo = repoOverrides as AuthRepository;
  const provisionWorkspace = jest.fn().mockResolvedValue({
    id: 'ws-1',
    title: 'Workspace',
    owner_id: 'user-1',
    is_personal_workspace: true,
    status: 'active',
  });
  const workspaceService = {
    provision: provisionWorkspace,
    findForUser: jest.fn(),
    ...workspaceOverrides,
  } as unknown as PersonalWorkspaceService;
  const eligibilityService = {
    check:
      eligibilityOverrides.check ??
      jest.fn().mockResolvedValue({ eligible: false, missing: [] }),
  } as any;
  const emailOtpService = {
    requestEmailVerification: jest.fn(),
    confirmEmailVerification: jest.fn(),
    requestPasswordReset: jest.fn(),
    confirmPasswordReset: jest.fn(),
  } as unknown as EmailOtpService;
  return {
    service: new AuthService(
      repo,
      workspaceService,
      eligibilityService,
      emailOtpService,
    ),
    provisionWorkspace,
  };
}

describe('AuthService.completeOnboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('completes onboarding and provisions a personal workspace for every user', async () => {
    const completeOnboarding = jest
      .fn<Promise<Profile>, [string]>()
      .mockResolvedValue(buildProfile());

    const { service, provisionWorkspace } = buildService({
      completeOnboarding,
    });

    const result = await service.completeOnboarding('user-1');

    expect(completeOnboarding).toHaveBeenCalledWith('user-1');
    expect(provisionWorkspace).toHaveBeenCalledWith('user-1');
    expect(result.personal_workspace_id).toBe('ws-1');
    expect(result.personal_team_id).toBeNull();
  });

  it('provisions a workspace even for a verified consultant (no team at signup)', async () => {
    const completeOnboarding = jest
      .fn<Promise<Profile>, [string]>()
      .mockResolvedValue(buildProfile({ is_consultant_verified: true }));

    const { service, provisionWorkspace } = buildService({
      completeOnboarding,
    });

    const result = await service.completeOnboarding('user-1');

    expect(provisionWorkspace).toHaveBeenCalledWith('user-1');
    expect(result.personal_team_id).toBeNull();
  });

  it('surfaces a workspace provisioning failure', async () => {
    const completeOnboarding = jest
      .fn<Promise<Profile>, [string]>()
      .mockResolvedValue(buildProfile());
    const provision = jest
      .fn()
      .mockRejectedValue(new Error('partial unique violation outside race'));

    const { service } = buildService({ completeOnboarding }, {
      provision,
    } as Partial<PersonalWorkspaceService>);

    await expect(service.completeOnboarding('user-1')).rejects.toThrow(
      'partial unique violation outside race',
    );
  });
});
