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
import { WorkspacesService } from '../../execution/workspaces/workspaces.service';
import { EmailOtpService } from './email-otp.service';
import type { AuthProfile } from './repositories/auth.repository.interface';

export interface CompleteOnboardingResult {
  profile: AuthProfile;
  /** The organization the user lands in. Null only for guests. */
  workspace_id: string | null;
  /**
   * Always null. Signup used to auto-create a personal project ("X's Space")
   * for every new user; it no longer does — a user's first project is one they
   * asked for. The field stays in the response so a client running an older
   * bundle keeps parsing it, and so do its two deprecated aliases below.
   */
  personal_project_id: string | null;
  /** Deprecated alias for `personal_project_id`. Always null. */
  personal_workspace_id: string | null;
  /** Always null: consultants create teams after vetting, not at signup. */
  personal_team_id: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly authRepo: AuthRepository,
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

    // Every user gets a workspace — the organization tier they land in. That
    // is the whole of signup provisioning: no personal project is created for
    // them any more, because an empty project nobody asked for is clutter the
    // user then has to explain to themselves. Their first project is the one
    // they create. Existing personal projects are untouched.
    //
    // personal_project_id / personal_workspace_id / personal_team_id stay in
    // the response shape for older clients and are always null.
    let workspace_id: string | null = null;

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

    return {
      profile,
      workspace_id,
      personal_project_id: null,
      personal_workspace_id: null,
      personal_team_id: null,
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
