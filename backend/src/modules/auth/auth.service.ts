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

export interface CompleteOnboardingResult {
  profile: Profile;
  personal_workspace_id: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly authRepo: AuthRepository,
    private readonly personalWorkspaceService: PersonalWorkspaceService,
  ) {}

  async getProfile(userId: string): Promise<Profile> {
    const profile = await this.authRepo.getProfile(userId);
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
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

    // Provision the personal workspace as part of the same orchestration.
    // Idempotent: re-runs are no-ops. If this throws, the onboarding state is
    // already persisted — surface the error so the client can retry, but
    // don't roll back the persona/lane writes.
    let personal_workspace_id: string;
    try {
      const workspace = await this.personalWorkspaceService.provision(userId);
      personal_workspace_id = workspace.id;
    } catch (err) {
      this.logger.error(
        `Failed to provision personal workspace for ${userId} after onboarding: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }

    return { profile, personal_workspace_id };
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
    return this.authRepo.switchPersona(userId, dto.persona);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<Profile> {
    return this.authRepo.updateProfile(userId, dto);
  }
}
