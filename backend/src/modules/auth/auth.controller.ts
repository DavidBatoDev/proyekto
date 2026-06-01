import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SetCachePolicy } from '../../common/decorators/cache-policy.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CACHE_POLICY_PRESETS } from '../../common/cache/cache-policy';
import {
  CompleteOnboardingDto,
  OnboardingDto,
  SwitchPersonaDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import {
  EmailVerificationConfirmDto,
  EmailVerificationRequestDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
} from './dto/email-auth.dto';

@Controller('auth')
@UseGuards(SupabaseAuthGuard)
@SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('email-verification/request')
  requestEmailVerification(@Body() dto: EmailVerificationRequestDto) {
    return this.authService.requestEmailVerification(dto);
  }

  @Public()
  @Post('email-verification/confirm')
  confirmEmailVerification(@Body() dto: EmailVerificationConfirmDto) {
    return this.authService.confirmEmailVerification(dto);
  }

  @Public()
  @Post('password-reset/request')
  requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Public()
  @Post('password-reset/confirm')
  confirmPasswordReset(@Body() dto: PasswordResetConfirmDto) {
    return this.authService.confirmPasswordReset(dto);
  }

  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id);
  }

  @Post('onboarding')
  onboarding(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OnboardingDto,
  ) {
    return this.authService.onboarding(user.id, dto);
  }

  @Patch('onboarding/complete')
  completeOnboarding(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CompleteOnboardingDto,
  ) {
    return this.authService.completeOnboarding(user.id, dto);
  }

  @Patch('persona')
  switchPersona(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SwitchPersonaDto,
  ) {
    return this.authService.switchPersona(user.id, dto);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.id, dto);
  }
}
