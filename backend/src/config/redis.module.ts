import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';
import { RedisDataCacheService } from '../common/cache/redis-data-cache.service';
import { RedisCacheInvalidationService } from '../common/cache/redis-cache-invalidation.service';
import { CloudflareCachePurgeService } from '../common/cache/cloudflare-cache-purge.service';
import { UPSTASH_REDIS_CLIENT } from './redis.tokens';

@Global()
@Module({
  providers: [
    {
      provide: UPSTASH_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis | null => {
        const redisUrl = configService.get<string>('UPSTASH_REDIS_REST_URL');
        const redisToken = configService.get<string>('UPSTASH_REDIS_REST_TOKEN');

        if (!redisUrl || !redisToken) {
          return null;
        }

        return new Redis({ url: redisUrl, token: redisToken });
      },
    },
    CloudflareCachePurgeService,
    RedisDataCacheService,
    RedisCacheInvalidationService,
  ],
  exports: [
    UPSTASH_REDIS_CLIENT,
    CloudflareCachePurgeService,
    RedisDataCacheService,
    RedisCacheInvalidationService,
  ],
})
export class RedisModule {}
