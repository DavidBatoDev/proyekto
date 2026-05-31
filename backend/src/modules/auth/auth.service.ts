import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');
import type { AuthRepository } from './repositories/auth.repository.interface';
import {
  CompleteOnboardingDto,
  OnboardingDto,
  SwitchPersonaDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { Profile } from '../../common/entities';
import { PersonalWorkspaceService } from '../projects/personal-workspace.service';
import {
  FreelancerEligibilityService,
  type FreelancerRequirement,
} from '../profile/freelancer-eligibility.service';
import { TeamsService } from '../teams/teams.service';

export interface CompleteOnboardingResult {
  profile: Profile;
  personal_workspace_id: string | null;
  personal_team_id: string | null;
}

export interface ProfileWithEligibility extends Profile {
  missingFreelancerRequirements: FreelancerRequirement[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly authRepo: AuthRepository,
    private readonly personalWorkspaceService: PersonalWorkspaceService,
    private readonly freelancerEligibility: FreelancerEligibilityService,
    private readonly teamsService: TeamsService,
  ) {}

  async getProfile(userId: string): Promise<ProfileWithEligibility> {
    const profile = await this.authRepo.getProfile(userId);
    if (!profile) throw new NotFoundException('Profile not found');
    // Attach the freelancer-eligibility checklist so the dashboard sidebar
    // can show what's left without a separate roundtrip. Cheap (4 small
    // lookups) and re-evaluated per request.
    const { missing } = await this.freelancerEligibility.check(userId);
    return { ...profile, missingFreelancerRequirements: missing };
  }

  async onboarding(userId: string, dto: OnboardingDto): Promise<Profile> {
    return this.authRepo.updateOnboarding(userId, {
      active_persona: dto.active_persona,
      display_name: dto.display_name,
    });
  }

  async completeOnboarding(
    userId: string,
    dto: CompleteOnboardingDto,
  ): Promise<CompleteOnboardingResult> {
    // Lane-driven persona default. Client/Freelancer-lane users are clients
    // out of the gate; consultant-lane users keep the freelancer default until
    // their application is approved (which flips is_consultant_verified and
    // unlocks the consultant persona via switchPersona).
    const active_persona =
      dto.lane === 'client_freelancer' ? 'client' : undefined;

    const profile = await this.authRepo.completeOnboarding(userId, {
      lane: dto.lane,
      intent: dto.intent,
      active_persona,
    });

    // Lane-scoped provisioning: consultants get a personal team, clients
    // keep the personal workspace project. Either path is idempotent on
    // re-run. If provisioning throws, the onboarding state is already
    // persisted — surface the error so the client can retry without
    // rolling back the persona/lane writes.
    let personal_workspace_id: string | null = null;
    let personal_team_id: string | null = null;

    try {
      if (dto.lane === 'consultant') {
        const team = await this.teamsService.provisionPersonalTeam(userId);
        personal_team_id = team.id;
      } else {
        const workspace = await this.personalWorkspaceService.provision(userId);
        personal_workspace_id = workspace.id;
      }
    } catch (err) {
      this.logger.error(
        `Failed to provision lane-scoped artifact for ${userId} (lane=${dto.lane}) after onboarding: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }

    return { profile, personal_workspace_id, personal_team_id };
  }

  async switchPersona(userId: string, dto: SwitchPersonaDto): Promise<Profile> {
    if (dto.persona === 'consultant') {
      const profile = await this.authRepo.getProfile(userId);
      if (!profile) throw new NotFoundException('Profile not found');
      if (!profile.is_consultant_verified) {
        throw new ForbiddenException(
          'Consultant verification required to switch to consultant persona',
        );
      }
    }
    if (dto.persona === 'freelancer') {
      // Quality-bar enforcement. The dashboard checklist normally guides
      // the user to satisfy these BEFORE they hit this endpoint, but the
      // server is the source of truth.
      const { eligible, missing } =
        await this.freelancerEligibility.check(userId);
      if (!eligible) {
        throw new ForbiddenException(
          `Complete your freelancer profile first. Missing: ${missing.join(', ')}`,
        );
      }
    }
    return this.authRepo.switchPersona(userId, dto.persona);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<Profile> {
    return this.authRepo.updateProfile(userId, dto);
  }
}
