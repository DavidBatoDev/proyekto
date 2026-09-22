import {
  Controller,
  Get,
  Logger,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CACHE_POLICY_PRESETS } from '../../../../common/cache/cache-policy';
import { SetCachePolicy } from '../../../../common/decorators/cache-policy.decorator';
import { Public } from '../../../../common/decorators/public.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import { toPublicPlans, type PublicPlans } from '../entitlements.logic';
import { EntitlementsService } from '../entitlements.service';

/**
 * GET /api/plans: the plan-limits matrix behind /pricing, for anyone.
 *
 * Edge-cached (PUBLIC_EDGE_SHORT) and purged by invalidateLimits after an
 * admin edit. It omits what only staff see: who changed a cell, which keys the
 * code enforces, and registry drift.
 */
@Controller('plans')
@UseGuards(SupabaseAuthGuard)
export class PlansController {
  private readonly logger = new Logger(PlansController.name);

  constructor(private readonly entitlements: EntitlementsService) {}

  @Get()
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT)
  async list(
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicPlans> {
    try {
      return toPublicPlans(await this.entitlements.getLimitMatrix());
    } catch (error) {
      // CachePolicyInterceptor set the public header before the handler ran.
      // Replace it, or the edge would cache this 503 for everyone; the web
      // falls back to its built-in copy of the table meanwhile.
      response.setHeader('Cache-Control', 'no-store');
      this.logger.warn(
        `plans_matrix_unavailable message=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException(
        'Plan limits are unavailable right now.',
      );
    }
  }
}
