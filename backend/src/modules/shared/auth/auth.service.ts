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
import { PersonalProjectService } from '../../execution/projects/personal-project.service';
import { WorkspacesService } from '../../execution/workspaces/workspaces.service';
import { EmailOtpService } from './email-otp.service';
import type { AuthProfile } from './repositories/auth.repository.interface';

export interface CompleteOnboardingResult {
  profile: AuthProfile;
  /** The organization the user lands in. Null only for guests. */
  workspace_id: string | null;
  personal_project_id: string | null;
  /**
   * Deprecated alias for `personal_project_id`, kept so a client running the
   * previous bundle keeps working through the deploy window. Remove once the
   * web app no longer reads it.
   */
  personal_workspace_id: string | null;
  personal_team_id: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly authRepo: AuthRepository,
    private readonly personalProjectService: PersonalProjectService,
    private readonly workspacesService: WorkspacesService,
    private readonly emailOtpService: EmailOtpService,
  ) {}

  async getProfile(userId: string): Promise<AuthProfile> {
    const profile = await this.authRepo.getProfile(userId);
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  async completeOnboarding(userId: string): Promise<CompleteOnboardingResult> {
    const profile = await this.authRepo.completeOnboarding(userId);

    // Every user gets a workspace and a personal project — there is no signup
    // lane, so no role-scoped provisioning. Both are idempotent on re-run. If
    // provisioning throws, the onboarding state is already persisted — surface
    // the error so the client can retry without rolling back the onboarding
    // write.
    // personal_team_id stays in the response shape for older clients; it is
    // always null now (consultants create teams after vetting, not at signup).
    let workspace_id: string | null = null;
    let personal_project_id: string | null = null;
    const personal_team_id: string | null = null;

    // The workspace comes FIRST: it is the backstop behind the required
    // "create your workspace" step, and provision_personal_project stamps the
    // personal project into it, so the order decides whether that project has
    // an organizational home on the very first call.
    try {
      const workspace = await this.workspacesService.provisionDefault(userId);
      workspace_id = workspace?.id ?? null;
    } catch (err) {
      this.logger.error(
        `Failed to provision default workspace for ${userId} after onboarding: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }

    try {
      const personalProject =
        await this.personalProjectService.provision(userId);
      personal_project_id = personalProject.id;
    } catch (err) {
      this.logger.error(
        `Failed to provision personal project for ${userId} after onboarding: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }

    return {
      profile,
      workspace_id,
      personal_project_id,
      personal_workspace_id: personal_project_id,
      personal_team_id,
    };
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<AuthProfile> {
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
