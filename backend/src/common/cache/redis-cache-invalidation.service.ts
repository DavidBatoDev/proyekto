import { Injectable, Logger } from '@nestjs/common';
import { CloudflareCachePurgeService } from './cloudflare-cache-purge.service';
import { REDIS_CACHE_KEYS } from './redis-cache.keys';
import { RedisDataCacheService } from './redis-data-cache.service';

@Injectable()
export class RedisCacheInvalidationService {
  private readonly logger = new Logger(RedisCacheInvalidationService.name);

  constructor(
    private readonly cache: RedisDataCacheService,
    private readonly cloudflarePurge: CloudflareCachePurgeService,
  ) {}

  private async runBestEffort(
    operation: string,
    executor: () => Promise<void>,
  ): Promise<void> {
    try {
      await executor();
    } catch (error) {
      this.logger.warn(
        `cache_invalidate operation=${operation} status=error message=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async invalidateConsultantsCache(userId?: string): Promise<void> {
    const keys: string[] = [REDIS_CACHE_KEYS.consultantsList];
    const paths: string[] = ['/api/consultants'];
    if (userId) {
      keys.push(REDIS_CACHE_KEYS.consultantsProfile(userId));
      paths.push(`/api/consultants/${encodeURIComponent(userId)}`);
    }

    this.logger.log(
      `cache_invalidate scope=consultants key_count=${keys.length} path_count=${paths.length}`,
    );

    await Promise.all([
      this.runBestEffort('redis_del_many_consultants', () =>
        this.cache.delMany(keys),
      ),
      this.runBestEffort('edge_purge_consultants', () =>
        this.cloudflarePurge.purgePaths(paths),
      ),
    ]);
  }

  async invalidatePublicRoadmapTemplatesCache(): Promise<void> {
    this.logger.log(
      'cache_invalidate scope=public_roadmap_templates key_count=1 path_count=1',
    );
    await Promise.all([
      this.runBestEffort('redis_del_public_templates', () =>
        this.cache.del(REDIS_CACHE_KEYS.publicRoadmapTemplates),
      ),
      this.runBestEffort('edge_purge_public_templates', () =>
        this.cloudflarePurge.purgePaths(['/api/roadmaps/templates/public']),
      ),
    ]);
  }

  async invalidateDashboardCacheForUser(userId: string): Promise<void> {
    this.logger.log(
      `cache_invalidate scope=dashboard_user user_id=${userId} key_count=1`,
    );
    await this.cache.del(REDIS_CACHE_KEYS.projectsDashboardByUser(userId));
  }

  async invalidateAllDashboardCache(): Promise<void> {
    this.logger.log('cache_invalidate scope=dashboard_all index_count=1');
    await this.cache.clearIndex(REDIS_CACHE_KEYS.projectsDashboardIndex);
  }

  async invalidateMarketplaceFreelancersCache(): Promise<void> {
    this.logger.log('cache_invalidate scope=marketplace index_count=1');
    await this.cache.clearIndex(REDIS_CACHE_KEYS.marketplaceFreelancersIndex);
  }

  async invalidateDiscoveryCaches(userId: string): Promise<void> {
    await Promise.all([
      this.invalidateConsultantsCache(userId),
      this.invalidateMarketplaceFreelancersCache(),
    ]);
  }
}
