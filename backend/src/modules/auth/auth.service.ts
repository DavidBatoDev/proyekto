import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');
import type { AuthRepository } from './repositories/auth.repository.interface';
import { UpdateProfileDto } from './dto/auth.dto';
import {
  EmailVerificationConfirmDto,
  EmailVerificationRequestDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
} from './dto/email-auth.dto';
import { Profile } from '../../common/entities';
import { PersonalWorkspaceService } from '../execution/projects/personal-workspace.service';
import {
  FreelancerEligibilityService,
  type FreelancerRequirement,
} from '../marketplace/profile/freelancer-eligibility.service';
import { EmailOtpService } from './email-otp.service';

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
    private readonly emailOtpService: EmailOtpService,
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

  async completeOnboarding(userId: string): Promise<CompleteOnboardingResult> {
    const profile = await this.authRepo.completeOnboarding(userId);

    // Every user gets a personal workspace — there is no signup lane, so no
    // role-scoped provisioning. Idempotent on re-run. If provisioning throws,
    // the onboarding state is already persisted — surface the error so the
    // client can retry without rolling back the onboarding write.
    // personal_team_id stays in the response shape for older clients; it is
    // always null now (consultants create teams after vetting, not at signup).
    let personal_workspace_id: string | null = null;
    const personal_team_id: string | null = null;

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

    return { profile, personal_workspace_id, personal_team_id };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<Profile> {
    return this.authRepo.updateProfile(userId, dto);
  }

  async requestEmailVerification(dto: EmailVerificationRequestDto) {
    return this.emailOtpService.requestEmailVerification(dto);
  }

  async confirmEmailVerification(dto: EmailVerificationConfirmDto) {
    return this.emailOtpService.confirmEmailVerification(dto);
  }

  async requestPasswordReset(dto: PasswordResetRequestDto) {
    return this.emailOtpService.requestPasswordReset(dto);
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto) {
    return this.emailOtpService.confirmPasswordReset(dto);
  }
}
