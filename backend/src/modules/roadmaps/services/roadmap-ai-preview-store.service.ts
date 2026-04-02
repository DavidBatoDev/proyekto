import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';

@Injectable()
export class RoadmapAiPreviewStoreService {
  private readonly redis: Redis | null;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('UPSTASH_REDIS_REST_URL');
    const redisToken = this.configService.get<string>(
      'UPSTASH_REDIS_REST_TOKEN',
    );
    this.redis =
      redisUrl && redisToken
        ? new Redis({ url: redisUrl, token: redisToken })
        : null;
  }

  async setPreview<T extends Record<string, unknown>>(
    previewId: string,
    payload: T,
    ttlSeconds: number,
  ): Promise<void> {
    const redis = this.requireRedis();
    const key = this.previewKey(previewId);
    await redis.set(key, JSON.stringify(payload), { ex: ttlSeconds });
  }

  async getPreview<T extends Record<string, unknown>>(
    previewId: string,
  ): Promise<T | null> {
    const redis = this.requireRedis();
    const key = this.previewKey(previewId);
    const value = await redis.get<string | null>(key);
    if (!value || typeof value !== 'string') return null;
    return JSON.parse(value) as T;
  }

  async deletePreview(previewId: string): Promise<void> {
    const redis = this.requireRedis();
    await redis.del(this.previewKey(previewId));
  }

  async setResolution<T extends Record<string, unknown>>(
    resolutionId: string,
    payload: T,
    ttlSeconds: number,
  ): Promise<void> {
    const redis = this.requireRedis();
    await redis.set(this.resolutionKey(resolutionId), JSON.stringify(payload), {
      ex: ttlSeconds,
    });
  }

  async getResolution<T extends Record<string, unknown>>(
    resolutionId: string,
  ): Promise<T | null> {
    const redis = this.requireRedis();
    const value = await redis.get<string | null>(this.resolutionKey(resolutionId));
    if (!value || typeof value !== 'string') return null;
    return JSON.parse(value) as T;
  }

  async deleteResolution(resolutionId: string): Promise<void> {
    const redis = this.requireRedis();
    await redis.del(this.resolutionKey(resolutionId));
  }

  async setResolveLookup<T extends Record<string, unknown> | unknown[]>(
    cacheKey: string,
    payload: T,
    options?: { ttlSeconds?: number },
  ): Promise<void> {
    const redis = this.requireRedis();
    const ttlSeconds = Math.max(30, options?.ttlSeconds ?? 180);
    await redis.set(cacheKey, JSON.stringify(payload), { ex: ttlSeconds });

    const roadmapId = this.extractRoadmapIdFromResolveKey(cacheKey);
    if (roadmapId) {
      await redis.sadd(this.resolveLookupRoadmapKey(roadmapId), cacheKey);
      await redis.expire(this.resolveLookupRoadmapKey(roadmapId), ttlSeconds);
    }
  }

  async getResolveLookup<T extends Record<string, unknown> | unknown[]>(
    cacheKey: string,
  ): Promise<T | null> {
    const redis = this.requireRedis();
    const value = await redis.get<string | null>(cacheKey);
    if (!value || typeof value !== 'string') return null;
    return JSON.parse(value) as T;
  }

  async deleteResolveLookupByRoadmap(roadmapId: string): Promise<void> {
    const redis = this.requireRedis();
    const roadmapKey = this.resolveLookupRoadmapKey(roadmapId);
    const keys = await redis.smembers<string[]>(roadmapKey);
    if (Array.isArray(keys) && keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.del(roadmapKey);
  }

  private previewKey(previewId: string): string {
    return `roadmap:ai:preview:${previewId}`;
  }

  private resolutionKey(resolutionId: string): string {
    return `roadmap:ai:resolution:${resolutionId}`;
  }

  private resolveLookupRoadmapKey(roadmapId: string): string {
    return `roadmap:resolve:index:${roadmapId}`;
  }

  private extractRoadmapIdFromResolveKey(cacheKey: string): string | null {
    const parts = cacheKey.split(':');
    if (parts.length < 5) return null;
    if (parts[0] !== 'roadmap' || parts[1] !== 'resolve') return null;
    return parts[3] || null;
  }

  private requireRedis(): Redis {
    if (this.redis) return this.redis;
    throw new ServiceUnavailableException(
      'Roadmap AI preview store is unavailable: Redis is not configured.',
    );
  }
}
