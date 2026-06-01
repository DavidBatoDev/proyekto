import { AuthService } from './auth.service';
import type { AuthRepository } from './repositories/auth.repository.interface';
import type { PersonalWorkspaceService } from '../projects/personal-workspace.service';
import type { TeamsService } from '../teams/teams.service';
import type { Profile } from '../../common/entities';
import type { CompleteOnboardingDto } from './dto/auth.dto';
import type { EmailOtpService } from './email-otp.service';

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
  teamsOverrides: Partial<TeamsService> = {},
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
  const teamsService = {
    provisionPersonalTeam: jest.fn().mockResolvedValue({
      id: 'team-1',
      owner_id: 'user-1',
      name: "A's Team",
      description: null,
      avatar_url: null,
      is_personal: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
    ...teamsOverrides,
  } as unknown as TeamsService;
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
      teamsService,
      emailOtpService,
    ),
    workspaceService,
    teamsService,
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

  it('client_freelancer lane: provisions personal workspace, no team', async () => {
    const completeOnboarding = jest
      .fn<Promise<Profile>, [string, any]>()
      .mockResolvedValue(buildProfile());

    const { service, workspaceService, teamsService } = buildService({
      completeOnboarding,
    });

    const result = await service.completeOnboarding(
      'user-1',
      dtoForLane('client_freelancer'),
    );

    expect(workspaceService.provision).toHaveBeenCalledWith('user-1');
    expect(teamsService.provisionPersonalTeam).not.toHaveBeenCalled();
    expect(result.personal_workspace_id).toBe('ws-1');
    expect(result.personal_team_id).toBeNull();
  });

  it('consultant lane: provisions personal team, no workspace', async () => {
    const completeOnboarding = jest
      .fn<Promise<Profile>, [string, any]>()
      .mockResolvedValue(buildProfile());

    const { service, workspaceService, teamsService } = buildService({
      completeOnboarding,
    });

    const result = await service.completeOnboarding(
      'user-1',
      dtoForLane('consultant'),
    );

    expect(teamsService.provisionPersonalTeam).toHaveBeenCalledWith('user-1');
    expect(workspaceService.provision).not.toHaveBeenCalled();
    expect(result.personal_team_id).toBe('team-1');
    expect(result.personal_workspace_id).toBeNull();
  });

  it('surfaces a workspace provisioning failure on the client lane', async () => {
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

  it('surfaces a team provisioning failure on the consultant lane', async () => {
    const completeOnboarding = jest
      .fn<Promise<Profile>, [string, any]>()
      .mockResolvedValue(buildProfile());

    const { service } = buildService(
      { completeOnboarding },
      {},
      {},
      {
        provisionPersonalTeam: jest
          .fn()
          .mockRejectedValue(new Error('teams insert failed')),
      } as Partial<TeamsService>,
    );

    await expect(
      service.completeOnboarding('user-1', dtoForLane('consultant')),
    ).rejects.toThrow('teams insert failed');
  });
});
