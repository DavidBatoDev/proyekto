import { AuthService } from './auth.service';
import type { AuthRepository } from './repositories/auth.repository.interface';
import type { PersonalWorkspaceService } from '../projects/personal-workspace.service';
import type { Profile } from '../../common/entities';
import type { CompleteOnboardingDto } from './dto/auth.dto';

function buildProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'user-1',
    email: 'a@b.com',
    display_name: 'A',
    avatar_url: null,
    is_consultant_verified: false,
    active_persona: 'freelancer',
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
  const workspaceService = {
    provision: jest.fn().mockResolvedValue({
      id: 'ws-1',
      title: 'Workspace',
      client_id: 'user-1',
      is_personal_workspace: true,
      status: 'active',
    }),
    findForUser: jest.fn(),
    ...workspaceOverrides,
  } as unknown as PersonalWorkspaceService;
  const eligibilityService = {
    check:
      eligibilityOverrides.check ??
      jest.fn().mockResolvedValue({ eligible: false, missing: [] }),
  } as any;
  return {
    service: new AuthService(repo, workspaceService, eligibilityService),
    workspaceService,
  };
}

describe('AuthService.completeOnboarding', () => {
  const dtoForLane = (
    lane: 'client_freelancer' | 'consultant',
  ): CompleteOnboardingDto => ({
    lane,
    intent: { freelancer: lane === 'client_freelancer', client: false },
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets active_persona to "client" for the client_freelancer lane', async () => {
    const completeOnboarding = jest
      .fn<Promise<Profile>, [string, any]>()
      .mockResolvedValue(buildProfile({ active_persona: 'client' }));

    const { service } = buildService({ completeOnboarding });

    await service.completeOnboarding('user-1', dtoForLane('client_freelancer'));

    expect(completeOnboarding).toHaveBeenCalledWith('user-1', {
      lane: 'client_freelancer',
      intent: { freelancer: true, client: false },
      active_persona: 'client',
    });
  });

  it('omits active_persona override for the consultant lane (keeps existing default)', async () => {
    const completeOnboarding = jest
      .fn<Promise<Profile>, [string, any]>()
      .mockResolvedValue(buildProfile({ active_persona: 'freelancer' }));

    const { service } = buildService({ completeOnboarding });

    await service.completeOnboarding('user-1', dtoForLane('consultant'));

    expect(completeOnboarding).toHaveBeenCalledWith('user-1', {
      lane: 'consultant',
      intent: { freelancer: false, client: false },
      active_persona: undefined,
    });
  });

  it('provisions a personal workspace and returns its id alongside the profile', async () => {
    const completeOnboarding = jest
      .fn<Promise<Profile>, [string, any]>()
      .mockResolvedValue(buildProfile());

    const { service, workspaceService } = buildService({ completeOnboarding });

    const result = await service.completeOnboarding(
      'user-1',
      dtoForLane('client_freelancer'),
    );

    expect(workspaceService.provision).toHaveBeenCalledWith('user-1');
    expect(result.personal_workspace_id).toBe('ws-1');
    expect(result.profile.id).toBe('user-1');
  });

  it('provisions a personal workspace even for consultant-lane users (soft isolation)', async () => {
    const completeOnboarding = jest
      .fn<Promise<Profile>, [string, any]>()
      .mockResolvedValue(buildProfile());

    const { service, workspaceService } = buildService({ completeOnboarding });

    await service.completeOnboarding('user-1', dtoForLane('consultant'));

    expect(workspaceService.provision).toHaveBeenCalledWith('user-1');
  });

  it('surfaces a workspace provisioning failure to the caller', async () => {
    const completeOnboarding = jest
      .fn<Promise<Profile>, [string, any]>()
      .mockResolvedValue(buildProfile());
    const provision = jest
      .fn()
      .mockRejectedValue(new Error('partial unique violation outside race'));

    const { service } = buildService(
      { completeOnboarding },
      { provision } as Partial<PersonalWorkspaceService>,
    );

    await expect(
      service.completeOnboarding('user-1', dtoForLane('client_freelancer')),
    ).rejects.toThrow('partial unique violation outside race');
  });
});
