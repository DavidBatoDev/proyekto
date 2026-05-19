import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../common/cache/redis-data-cache.service';
import { REDIS_CACHE_KEYS } from '../../common/cache/redis-cache.keys';

export const CONSULTANTS_REPOSITORY = Symbol('CONSULTANTS_REPOSITORY');

interface CacheReadOptions {
  onCacheStatus?: (status: AppCacheStatus) => void;
}

@Injectable()
export class ConsultantsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly cache: RedisDataCacheService,
  ) {}

  async findAll(options?: CacheReadOptions) {
    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.consultantsList,
      this.cache.getPublicTtlSeconds(),
      async () => {
        const { data } = await this.supabase
          .from('profiles')
          .select(
            'id, display_name, avatar_url, banner_url, headline, bio, country, city, active_persona, is_consultant_verified, created_at',
          )
          .eq('is_consultant_verified', true);
        return data || [];
      },
      { onStatus: options?.onCacheStatus },
    );
  }

  async findOne(id: string, options?: CacheReadOptions) {
    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.consultantsProfile(id),
      this.cache.getPublicTtlSeconds(),
      async () => {
        const { data } = await this.supabase
          .from('profiles')
          .select(
            'id, display_name, avatar_url, banner_url, headline, bio, country, city, active_persona, is_consultant_verified, created_at',
          )
          .eq('id', id)
          .eq('is_consultant_verified', true)
          .single();
        if (!data) throw new NotFoundException('Consultant not found');
        return data;
      },
      { onStatus: options?.onCacheStatus },
    );
  }
}
