import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SetCachePolicy } from '../../common/decorators/cache-policy.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CACHE_POLICY_PRESETS } from '../../common/cache/cache-policy';
import {
  CompleteOnboardingDto,
  OnboardingDto,
  SwitchPersonaDto,
  UpdateProfileDto,
} from './dto/auth.dto';

@Controller('auth')
@UseGuards(SupabaseAuthGuard)
@SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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

  @Post('provision')
  provisionArtifacts(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.provisionArtifacts(user.id);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.id, dto);
  }
}
