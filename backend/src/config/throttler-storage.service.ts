import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { Redis } from '@upstash/redis';

@Injectable()
export class ThrottlerStorageRedisService implements ThrottlerStorage {
  private readonly redis: Redis | null;
  private readonly localHits = new Map<
    string,
    { totalHits: number; expiresAt: number }
  >();
  private readonly localBlocks = new Map<string, number>();

  constructor(redisUrl?: string, redisToken?: string) {
    if (redisUrl && redisToken) {
      this.redis = new Redis({ url: redisUrl, token: redisToken });
      return;
    }

    this.redis = null;
  }

  async increment(
    key: string,
    ttl: number, // milliseconds (ThrottlerModule v6)
    limit: number,
    blockDuration: number, // milliseconds (ThrottlerModule v6)
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.redis) {
      return this.incrementInMemory(key, ttl, limit, blockDuration);
    }

    const blockKey = `${key}_block`;
    const ttlSec = Math.ceil(ttl / 1000);
    const blockSec = Math.ceil(blockDuration / 1000);

    // Check if this key is currently blocked
    const blockTtl = await this.redis.ttl(blockKey);
    if (blockTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: blockTtl,
      };
    }

    // Atomic increment + get TTL via pipeline
    const pipeline = this.redis.pipeline();
    pipeline.incr(key);
    pipeline.ttl(key);
    const [totalHitsRaw, currentTtlRaw] = await pipeline.exec();
    const totalHits =
      typeof totalHitsRaw === 'number'
        ? totalHitsRaw
        : Number(totalHitsRaw ?? 0);
    const currentTtl =
      typeof currentTtlRaw === 'number'
        ? currentTtlRaw
        : Number(currentTtlRaw ?? 0);

    // Set expiry window on first hit
    if (totalHits === 1) {
      await this.redis.expire(key, ttlSec);
    }

    const timeToExpire = currentTtl > 0 ? currentTtl : ttlSec;
    const isBlocked = totalHits > limit;
    let timeToBlockExpire = 0;

    // Set block key only on the hit that first exceeds the limit
    if (isBlocked && blockSec > 0 && totalHits === limit + 1) {
      await this.redis.set(blockKey, 1, { ex: blockSec });
      timeToBlockExpire = blockSec;
    }

    return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
  }

  private async incrementInMemory(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<ThrottlerStorageRecord> {
    const now = Date.now();
    const blockKey = `${key}_block`;

    const blockedUntil = this.localBlocks.get(blockKey);
    if (blockedUntil && blockedUntil > now) {
      return {
        totalHits: limit + 1,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: Math.ceil((blockedUntil - now) / 1000),
      };
    }

    if (blockedUntil && blockedUntil <= now) {
      this.localBlocks.delete(blockKey);
    }

    const current = this.localHits.get(key);
    if (!current || current.expiresAt <= now) {
      this.localHits.set(key, { totalHits: 1, expiresAt: now + ttl });
    } else {
      current.totalHits += 1;
      this.localHits.set(key, current);
    }

    const updated = this.localHits.get(key)!;
    const isBlocked = updated.totalHits > limit;

    if (isBlocked && blockDuration > 0 && updated.totalHits === limit + 1) {
      this.localBlocks.set(blockKey, now + blockDuration);
    }

    const timeToExpire = Math.max(
      0,
      Math.ceil((updated.expiresAt - now) / 1000),
    );
    const blockExpiresAt = this.localBlocks.get(blockKey);

    return {
      totalHits: updated.totalHits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: blockExpiresAt
        ? Math.max(0, Math.ceil((blockExpiresAt - now) / 1000))
        : 0,
    };
  }
}
