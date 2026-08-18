import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { SaveMarketplaceSurveyDto } from './dto/survey.dto';
import { SurveyService } from './survey.service';

/**
 * The marketplace intake survey — what someone said they came here to do, used
 * to order and re-label storefront sections.
 *
 * `SupabaseAuthGuard` only, with no `ConsultantOnlyGuard`: everyone takes this
 * survey, and gating a personalization row on a capability would be the first
 * step back towards the account role this product deleted in August 2026.
 * Nothing here is public — anonymous visitors get today's storefront untouched.
 */
@Controller('marketplace/survey')
@UseGuards(SupabaseAuthGuard)
export class SurveyController {
  constructor(private readonly survey: SurveyService) {}

  /** Null when never asked, which is the signal that opens the modal. */
  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.survey.findMine(user.id);
  }

  @Put('mine')
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveMarketplaceSurveyDto,
  ) {
    return this.survey.save(user.id, dto);
  }

  /**
   * Dismissal, and terminal. Its own route rather than a `status` a save could
   * set, so the transition that means "never ask again" has exactly one way in.
   */
  @Post('skip')
  skip(@CurrentUser() user: AuthenticatedUser) {
    return this.survey.skip(user.id);
  }
}
