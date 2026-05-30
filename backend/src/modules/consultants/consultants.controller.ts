import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConsultantsService } from './consultants.service';
import { Public } from '../../common/decorators/public.decorator';
import { SetCachePolicy } from '../../common/decorators/cache-policy.decorator';
import { CACHE_POLICY_PRESETS } from '../../common/cache/cache-policy';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../common/cache/redis-data-cache.service';

@Controller('consultants')
export class ConsultantsController {
  constructor(
    private readonly consultantsService: ConsultantsService,
    private readonly dataCache: RedisDataCacheService,
  ) {}

  private setCacheHeader(response: Response, status: AppCacheStatus): void {
    if (!this.dataCache.isDebugHeadersEnabled()) return;
    response.setHeader('X-App-Cache', status);
  }

  @Get()
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT)
  findAll(@Res({ passthrough: true }) response: Response) {
    return this.consultantsService.findAll({
      onCacheStatus: (status) => this.setCacheHeader(response, status),
    });
  }

  @Get(':id')
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT)
  findOne(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.consultantsService.findOne(id, {
      onCacheStatus: (status) => this.setCacheHeader(response, status),
    });
  }
}
