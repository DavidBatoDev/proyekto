import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';
import { UPSTASH_REDIS_CLIENT } from '../../config/redis.tokens';

export type AppCacheStatus = 'HIT' | 'MISS' | 'BYPASS' | 'ERROR';

export interface RememberJsonOptions {
  onStatus?: (status: AppCacheStatus) => void;
  indexKey?: string;
  indexTtlSeconds?: number;
}

function readPositiveInteger(
  configService: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = configService.get<string>(key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function readBoolean(
  configService: ConfigService,
  key: string,
  fallback: boolean,
): boolean {
  const raw = configService.get<string>(key);
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

@Injectable()
export class RedisDataCacheService {
  private readonly logger = new Logger(RedisDataCacheService.name);

  constructor(
    @Inject(UPSTASH_REDIS_CLIENT) private readonly redis: Redis | null,
    private readonly configService: ConfigService,
  ) {}

  isEnabled(): boolean {
    return readBoolean(this.configService, 'REDIS_DATA_CACHE_ENABLED', true);
  }

  isDebugHeadersEnabled(): boolean {
    return readBoolean(this.configService, 'REDIS_CACHE_DEBUG_HEADERS', false);
  }

  getPublicTtlSeconds(): number {
    return readPositiveInteger(
      this.configService,
      'REDIS_CACHE_PUBLIC_TTL_SECONDS',
      120,
    );
  }

  getAuthTtlSeconds(): number {
    return readPositiveInteger(
      this.configService,
      'REDIS_CACHE_AUTH_TTL_SECONDS',
      45,
    );
  }

  getDashboardTtlSeconds(): number {
    return readPositiveInteger(
      this.configService,
      'REDIS_CACHE_DASHBOARD_TTL_SECONDS',
      15,
    );
  }

  getMarketplaceIndexTtlSeconds(): number {
    return readPositiveInteger(
      this.configService,
      'REDIS_CACHE_MARKETPLACE_INDEX_TTL_SECONDS',
      86400,
    );
  }

  getTtlJitterPercent(): number {
    const raw = this.configService.get<string>('REDIS_CACHE_TTL_JITTER_PERCENT');
    if (!raw) return 10;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 10;
    const configured = parsed;
    return Math.max(0, Math.min(50, configured));
  }

  async rememberJson<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
    options?: RememberJsonOptions,
  ): Promise<T> {
    if (!this.isEnabled() || !this.redis || ttlSeconds <= 0) {
      options?.onStatus?.('BYPASS');
      this.logger.log(
        `cache_outcome status=BYPASS key=${key} ttl_seconds=${ttlSeconds}`,
      );
      return loader();
    }

    let cacheError = false;

    try {
      const cached = await this.redis.get(key);
      const decoded = this.decodeStoredValue<T>(cached);
      if (decoded.found) {
        options?.onStatus?.('HIT');
        this.logger.log(
          `cache_outcome status=HIT key=${key} ttl_seconds=${ttlSeconds}`,
        );
        return decoded.value as T;
      }
    } catch (error) {
      cacheError = true;
      this.logger.warn(
        `Cache read failed for key=${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const loaded = await loader();
    const jitteredTtlSeconds = this.applyTtlJitter(ttlSeconds);

    try {
      await this.redis.set(key, JSON.stringify(loaded), {
        ex: jitteredTtlSeconds,
      });

      if (options?.indexKey) {
        const indexTtlSeconds = Math.max(
          1,
          Math.floor(
            options.indexTtlSeconds ?? this.getMarketplaceIndexTtlSeconds(),
          ),
        );

        const pipeline = this.redis.pipeline();
        pipeline.sadd(options.indexKey, key);
        pipeline.expire(options.indexKey, indexTtlSeconds);
        await pipeline.exec();
      }
    } catch (error) {
      cacheError = true;
      this.logger.warn(
        `Cache write failed for key=${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    options?.onStatus?.(cacheError ? 'ERROR' : 'MISS');
    this.logger.log(
      `cache_outcome status=${cacheError ? 'ERROR' : 'MISS'} key=${key} ttl_seconds=${jitteredTtlSeconds}`,
    );
    return loaded;
  }

  async del(key: string): Promise<void> {
    if (!this.redis || !this.isEnabled()) return;
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(
        `Cache delete failed for key=${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async delMany(keys: string[]): Promise<void> {
    if (!this.redis || !this.isEnabled() || keys.length === 0) return;

    const uniqueKeys = [...new Set(keys.filter((key) => key.length > 0))];
    if (uniqueKeys.length === 0) return;

    try {
      await this.redis.del(...uniqueKeys);
    } catch (error) {
      this.logger.warn(
        `Cache delete-many failed for ${uniqueKeys.length} keys: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async clearIndex(indexKey: string): Promise<void> {
    if (!this.redis || !this.isEnabled()) return;

    try {
      const keys = await this.redis.smembers<string[]>(indexKey);
      if (Array.isArray(keys) && keys.length > 0) {
        await this.redis.del(...keys);
      }
      await this.redis.del(indexKey);
    } catch (error) {
      this.logger.warn(
        `Cache index clear failed for ${indexKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private decodeStoredValue<T>(value: unknown): {
    found: boolean;
    value?: T;
  } {
    if (value === null || value === undefined) return { found: false };

    if (typeof value === 'string') {
      try {
        return { found: true, value: JSON.parse(value) as T };
      } catch {
        return { found: false };
      }
    }

    if (typeof value === 'object') {
      return { found: true, value: value as T };
    }

    return { found: false };
  }

  private applyTtlJitter(ttlSeconds: number): number {
    if (ttlSeconds <= 1) return Math.max(1, Math.floor(ttlSeconds));

    const jitterPercent = this.getTtlJitterPercent();
    if (jitterPercent <= 0) return Math.max(1, Math.floor(ttlSeconds));

    const jitterWindow = Math.max(1, Math.floor((ttlSeconds * jitterPercent) / 100));
    const minTtl = Math.max(1, ttlSeconds - jitterWindow);
    const maxTtl = Math.max(minTtl, ttlSeconds + jitterWindow);

    const randomizedOffset = Math.floor(Math.random() * (maxTtl - minTtl + 1));
    return minTtl + randomizedOffset;
  }
}
