import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TalentService } from './talent.service';
import { Public } from '../../../common/decorators/public.decorator';
import { SetCachePolicy } from '../../../common/decorators/cache-policy.decorator';
import { CACHE_POLICY_PRESETS } from '../../../common/cache/cache-policy';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../../common/cache/redis-data-cache.service';

/**
 * Public talent detail. Lives under `marketplace/talent/:id` — no collision
 * with `@Controller('marketplace')`, whose routes are all static segments
 * (`freelancers`, `go-live/...`, `invites/...`).
 */
@Controller('marketplace/talent')
export class TalentController {
  constructor(
    private readonly talentService: TalentService,
    private readonly dataCache: RedisDataCacheService,
  ) {}

  private setCacheHeader(response: Response, status: AppCacheStatus): void {
    if (!this.dataCache.isDebugHeadersEnabled()) return;
    response.setHeader('X-App-Cache', status);
  }

  @Get(':id')
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT)
  findOne(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.talentService.findOne(id, {
      onCacheStatus: (status) => this.setCacheHeader(response, status),
    });
  }
}
