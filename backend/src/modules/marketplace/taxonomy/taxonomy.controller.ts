import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { SetCachePolicy } from '../../../common/decorators/cache-policy.decorator';
import { CACHE_POLICY_PRESETS } from '../../../common/cache/cache-policy';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { ConsultantOnlyGuard } from '../../../common/guards/consultant-only.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../../common/cache/redis-data-cache.service';
import { TaxonomyService } from './taxonomy.service';
import {
  CategorySlugParamDto,
  ReplaceConsultantSubcategoriesDto,
  SubcategorySlugParamDto,
} from './dto/taxonomy.dto';

@Controller('marketplace/categories')
@UseGuards(SupabaseAuthGuard)
export class TaxonomyController {
  constructor(
    private readonly taxonomy: TaxonomyService,
    private readonly dataCache: RedisDataCacheService,
  ) {}

  private setCacheHeader(response: Response, status: AppCacheStatus): void {
    if (this.dataCache.isDebugHeadersEnabled()) {
      response.setHeader('X-App-Cache', status);
    }
  }

  /**
   * Declared before `:categorySlug` on purpose - Nest matches in declaration
   * order, so a dynamic segment above this would swallow `navigation` as a slug.
   */
  @Get('navigation')
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT)
  navigation(@Res({ passthrough: true }) response: Response) {
    return this.taxonomy.navigation({
      onCacheStatus: (status) => this.setCacheHeader(response, status),
    });
  }

  /**
   * A consultant's own placements, and the full replace that sets them.
   *
   * Declared above `:categorySlug` for the same reason `navigation` is — Nest
   * matches in declaration order, so a dynamic segment first would swallow
   * `mine` as a category slug.
   *
   * Consultant-only: `consultant_subcategories` has an owner-write RLS policy
   * gated on `is_active_consultant` (20260818120100), and this guard is the
   * matching gate at the API edge so a suspended consultant gets a 403 with a
   * reason rather than an empty result.
   */
  @Get('mine')
  @UseGuards(ConsultantOnlyGuard)
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.taxonomy.listMyPlacements(user.id);
  }

  @Put('mine')
  @UseGuards(ConsultantOnlyGuard)
  replaceMine(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReplaceConsultantSubcategoriesDto,
  ) {
    return this.taxonomy.replaceMyPlacements(user.id, dto.subcategory_ids);
  }

  @Get(':categorySlug')
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT)
  category(
    @Param() params: CategorySlugParamDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.taxonomy.category(params.categorySlug, {
      onCacheStatus: (status) => this.setCacheHeader(response, status),
    });
  }

  @Get(':categorySlug/:subcategorySlug')
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT)
  subcategory(
    @Param() params: SubcategorySlugParamDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.taxonomy.subcategory(
      params.categorySlug,
      params.subcategorySlug,
      { onCacheStatus: (status) => this.setCacheHeader(response, status) },
    );
  }
}
