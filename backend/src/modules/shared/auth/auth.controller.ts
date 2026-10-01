import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SetCachePolicy } from '../../../common/decorators/cache-policy.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { CACHE_POLICY_PRESETS } from '../../../common/cache/cache-policy';
import { CompleteOnboardingDto, UpdateProfileDto } from './dto/auth.dto';
import {
  EmailAvailabilityDto,
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

  /**
   * Sign-up's first step: is this email already taken? Answers before the
   * person picks a password and fills in a profile, instead of failing at the
   * end. Public and IP-throttled; it reveals no more than sign-up itself does.
   */
  @Public()
  @Post('email-availability')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  checkEmailAvailability(@Body() dto: EmailAvailabilityDto) {
    return this.authService.checkEmailAvailability(dto);
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

  @Patch('onboarding/complete')
  completeOnboarding(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CompleteOnboardingDto,
  ) {
    // Body is validated for legacy-client compatibility but deliberately
    // unused — onboarding no longer records a lane or role.
    void dto;
    return this.authService.completeOnboarding(user.id);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.id, dto);
  }
}
