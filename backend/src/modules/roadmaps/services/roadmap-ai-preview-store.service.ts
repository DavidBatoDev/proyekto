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

  private previewKey(previewId: string): string {
    return `roadmap:ai:preview:${previewId}`;
  }

  private requireRedis(): Redis {
    if (this.redis) return this.redis;
    throw new ServiceUnavailableException(
      'Roadmap AI preview store is unavailable: Redis is not configured.',
    );
  }
}
