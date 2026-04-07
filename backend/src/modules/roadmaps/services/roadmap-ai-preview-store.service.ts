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
    const value = await redis.get(key);
    return this.decodeStoredValue<T>(value);
  }

  async deletePreview(previewId: string): Promise<void> {
    const redis = this.requireRedis();
    await redis.del(this.previewKey(previewId));
  }

  async getPreviewTtlSeconds(previewId: string): Promise<number | null> {
    const redis = this.requireRedis();
    const ttl = await redis.ttl(this.previewKey(previewId));
    return typeof ttl === 'number' ? ttl : null;
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
    const value = await redis.get(this.resolutionKey(resolutionId));
    return this.decodeStoredValue<T>(value);
  }

  async deleteResolution(resolutionId: string): Promise<void> {
    const redis = this.requireRedis();
    await redis.del(this.resolutionKey(resolutionId));
  }

  async setChangeTimeline<T extends Record<string, unknown>>(
    roadmapId: string,
    userId: string,
    payload: T,
    options?: { ttlSeconds?: number },
  ): Promise<void> {
    const redis = this.requireRedis();
    const ttlSeconds = Math.max(60, options?.ttlSeconds ?? 60 * 60 * 24 * 30);
    await redis.set(
      this.timelineKey(roadmapId, userId),
      JSON.stringify(payload),
      {
        ex: ttlSeconds,
      },
    );
  }

  async getChangeTimeline<T extends Record<string, unknown>>(
    roadmapId: string,
    userId: string,
  ): Promise<T | null> {
    const redis = this.requireRedis();
    const value = await redis.get(this.timelineKey(roadmapId, userId));
    return this.decodeStoredValue<T>(value);
  }

  async deleteChangeTimeline(roadmapId: string, userId: string): Promise<void> {
    const redis = this.requireRedis();
    await redis.del(this.timelineKey(roadmapId, userId));
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

      const nodeType = this.extractNodeTypeFromResolveKey(cacheKey);
      if (nodeType) {
        await redis.sadd(
          this.resolveLookupRoadmapNodeTypeKey(roadmapId, nodeType),
          cacheKey,
        );
        await redis.expire(
          this.resolveLookupRoadmapNodeTypeKey(roadmapId, nodeType),
          ttlSeconds,
        );
      }
    }
  }

  async getResolveLookup<T extends Record<string, unknown> | unknown[]>(
    cacheKey: string,
  ): Promise<T | null> {
    const redis = this.requireRedis();
    const value = await redis.get(cacheKey);
    return this.decodeStoredValue<T>(value);
  }

  async deleteResolveLookupByRoadmap(roadmapId: string): Promise<void> {
    const redis = this.requireRedis();
    const roadmapKey = this.resolveLookupRoadmapKey(roadmapId);
    const keys = await redis.smembers<string[]>(roadmapKey);
    if (Array.isArray(keys) && keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.del(roadmapKey);
    await redis.del(
      this.resolveLookupRoadmapNodeTypeKey(roadmapId, 'epic'),
      this.resolveLookupRoadmapNodeTypeKey(roadmapId, 'feature'),
      this.resolveLookupRoadmapNodeTypeKey(roadmapId, 'task'),
    );
  }

  async deleteResolveLookupByRoadmapAndNodeTypes(
    roadmapId: string,
    nodeTypes: Array<'epic' | 'feature' | 'task'>,
  ): Promise<void> {
    if (!Array.isArray(nodeTypes) || nodeTypes.length === 0) {
      await this.deleteResolveLookupByRoadmap(roadmapId);
      return;
    }

    const redis = this.requireRedis();
    const normalizedNodeTypes = [...new Set(nodeTypes)];
    const keysToDelete = new Set<string>();

    for (const nodeType of normalizedNodeTypes) {
      const typeIndexKey = this.resolveLookupRoadmapNodeTypeKey(
        roadmapId,
        nodeType,
      );
      const keys = await redis.smembers<string[]>(typeIndexKey);
      for (const key of keys ?? []) {
        if (typeof key === 'string' && key.length > 0) {
          keysToDelete.add(key);
        }
      }
      await redis.del(typeIndexKey);
    }

    const deleteList = [...keysToDelete];
    if (deleteList.length > 0) {
      await redis.del(...deleteList);
      await redis.srem(this.resolveLookupRoadmapKey(roadmapId), ...deleteList);
    }
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

  private resolveLookupRoadmapNodeTypeKey(
    roadmapId: string,
    nodeType: 'epic' | 'feature' | 'task',
  ): string {
    return `roadmap:resolve:index:${roadmapId}:${nodeType}`;
  }

  private timelineKey(roadmapId: string, userId: string): string {
    return `roadmap:ai:timeline:${roadmapId}:${userId}`;
  }

  private extractRoadmapIdFromResolveKey(cacheKey: string): string | null {
    const parts = cacheKey.split(':');
    if (parts.length < 5) return null;
    if (parts[0] !== 'roadmap' || parts[1] !== 'resolve') return null;
    return parts[3] || null;
  }

  private extractNodeTypeFromResolveKey(
    cacheKey: string,
  ): 'epic' | 'feature' | 'task' | null {
    const parts = cacheKey.split(':');
    if (parts.length < 6) return null;
    if (parts[0] !== 'roadmap' || parts[1] !== 'resolve') return null;
    const nodeType = parts[4];
    if (nodeType === 'epic' || nodeType === 'feature' || nodeType === 'task') {
      return nodeType;
    }
    return null;
  }

  private requireRedis(): Redis {
    if (this.redis) return this.redis;
    throw new ServiceUnavailableException(
      'Roadmap AI preview store is unavailable: Redis is not configured.',
    );
  }

  private decodeStoredValue<T>(value: unknown): T | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    }
    if (typeof value === 'object') {
      return value as T;
    }
    return null;
  }
}
