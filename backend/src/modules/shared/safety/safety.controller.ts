import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SetCachePolicy } from '../../../common/decorators/cache-policy.decorator';
import { CACHE_POLICY_PRESETS } from '../../../common/cache/cache-policy';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { UserThrottlerGuard } from '../../../common/guards/user-throttler.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { BlocksService } from './blocks.service';
import { BlockUserDto, CreateReportDto } from './dto/safety.dto';
import { ReportsService } from './reports.service';

/**
 * Report content and block people (App Store guideline 1.2). Every route acts
 * as the signed-in user; the services do the access checks.
 */
@Controller('safety')
@UseGuards(SupabaseAuthGuard)
export class SafetyController {
  constructor(
    private readonly reports: ReportsService,
    private readonly blocks: BlocksService,
  ) {}

  @Post('reports')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
  @HttpCode(HttpStatus.OK)
  report(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportDto) {
    return this.reports.report(user.id, dto);
  }

  @Get('blocks')
  @SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
  listBlocks(@CurrentUser() user: AuthenticatedUser) {
    return this.blocks.listBlocks(user.id);
  }

  @Post('blocks')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async block(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BlockUserDto,
  ): Promise<{ blocked: true }> {
    await this.blocks.block(user.id, dto.user_id);
    return { blocked: true };
  }

  @Delete('blocks/:userId')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async unblock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ blocked: false }> {
    await this.blocks.unblock(user.id, userId);
    return { blocked: false };
  }
}
