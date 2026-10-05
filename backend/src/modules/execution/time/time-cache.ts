// backend/src/modules/execution/time/time-cache.ts   (complete in P03)
//
// The For-resolver cache is keyed by an epoch instead of per-key eviction: policy writes, team toggles and
// assignment changes bump `time:lf:epoch`, and keys of an old epoch simply expire after LF_TTL_SECONDS.
// Redis is optional (UPSTASH_REDIS_CLIENT is null without credentials); every path degrades to a miss/no-op.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from '@upstash/redis';
import { UPSTASH_REDIS_CLIENT } from '../../../config/redis.tokens';
import type { LoggingForResult } from './time.types';

export const LF_TTL_SECONDS = 30;
export const LF_EPOCH_KEY = 'time:lf:epoch';
export const ALIAS_HITS_TTL_SECONDS = 40 * 24 * 3600;

export function loggingForKey(
  epoch: string,
  userId: string,
  projectId: string,
): string {
  return `time:lf:${epoch}:${userId}:${projectId}`;
}

export function aliasHitsKey(routeId: string, yyyymmdd: string): string {
  return `time:alias:hits:${routeId}:${yyyymmdd}`;
}

/** UTC day stamp for the alias counters. */
export function aliasHitsDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10).replace(/-/g, '');
}

const logger = new Logger('TimeCache');
const WARN_INTERVAL_MS = 60_000;
let lastWarnAt = 0;

/** Redis failures are logged at warn, at most once per minute per process. */
function warnThrottled(operation: string, error: unknown): void {
  const now = Date.now();
  if (now - lastWarnAt < WARN_INTERVAL_MS) return;
  lastWarnAt = now;
  logger.warn(
    `time cache ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/** Test seam: forget the warn throttle. */
export function resetTimeCacheWarnThrottle(): void {
  lastWarnAt = 0;
}

/** Usable without DI (TeamsService, EngagementAssignmentsService pass their own client). Never throws. */
export async function bumpLoggingForEpoch(redis: Redis | null): Promise<void> {
  if (!redis) return;
  try {
    await redis.incr(LF_EPOCH_KEY);
  } catch (error) {
    warnThrottled('epoch bump', error);
  }
}

function decodeLoggingFor(value: unknown): LoggingForResult | null {
  if (value === null || value === undefined) return null;
  // @upstash/redis deserialises JSON on read; a raw string is decoded here.
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object'
        ? (parsed as LoggingForResult)
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? (value as LoggingForResult) : null;
}

export interface AliasHitCount {
  routeId: string;
  /** yyyymmdd (UTC), see aliasHitsDay. */
  day: string;
  count: number;
}

/** One logging-for cache read (D56). */
export interface LoggingForCacheRead {
  /** null on a miss or a Redis error. */
  value: LoggingForResult | null;
  /** The epoch this read used. Pass it back to setLoggingFor so a bump during the compute never stores a
   *  stale result under the new epoch. null = no Redis or a Redis error: the write is skipped. */
  epoch: string | null;
}

@Injectable()
export class TimeCacheService {
  constructor(
    @Inject(UPSTASH_REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  private async epoch(redis: Redis): Promise<string> {
    const raw = await redis.get<string | number>(LF_EPOCH_KEY);
    return raw === null || raw === undefined ? '0' : String(raw);
  }

  /** Reads the epoch once, then the key under it. value null on a miss; both null on no Redis or an error. */
  async getLoggingFor(
    userId: string,
    projectId: string,
  ): Promise<LoggingForCacheRead> {
    if (!this.redis) return { value: null, epoch: null };
    try {
      const epoch = await this.epoch(this.redis);
      const raw = await this.redis.get(loggingForKey(epoch, userId, projectId));
      return { value: decodeLoggingFor(raw), epoch };
    } catch (error) {
      warnThrottled('read', error);
      return { value: null, epoch: null };
    }
  }

  /** Writes under `epoch`, the one getLoggingFor returned before the compute (D56), never a re-read epoch:
   *  if a writer bumped meanwhile, this lands under the old epoch, which no new read uses. null = skip. */
  async setLoggingFor(
    userId: string,
    projectId: string,
    value: LoggingForResult,
    epoch: string | null,
  ): Promise<void> {
    if (!this.redis || epoch === null) return;
    try {
      await this.redis.set(
        loggingForKey(epoch, userId, projectId),
        JSON.stringify(value),
        { ex: LF_TTL_SECONDS },
      );
    } catch (error) {
      warnThrottled('write', error);
    }
  }

  bumpEpoch(): Promise<void> {
    return bumpLoggingForEpoch(this.redis);
  }

  /** Pipelined INCR + EXPIRE; never throws; null Redis = no-op. */
  async incrAliasHit(routeId: string, at?: Date): Promise<void> {
    if (!this.redis) return;
    try {
      const key = aliasHitsKey(routeId, aliasHitsDay(at));
      const pipeline = this.redis.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, ALIAS_HITS_TTL_SECONDS);
      await pipeline.exec();
    } catch (error) {
      warnThrottled('alias hit', error);
    }
  }

  /** The buffered flush (D30, critic CC12): one pipeline of INCRBY <n> + EXPIRE per key. Never throws;
   *  null Redis = no-op; zero counts are skipped. */
  async flushAliasHits(counts: readonly AliasHitCount[]): Promise<void> {
    const live = counts.filter((c) => c.count > 0);
    if (!this.redis || live.length === 0) return;
    try {
      const pipeline = this.redis.pipeline();
      for (const c of live) {
        const key = aliasHitsKey(c.routeId, c.day);
        pipeline.incrby(key, Math.trunc(c.count));
        pipeline.expire(key, ALIAS_HITS_TTL_SECONDS);
      }
      await pipeline.exec();
    } catch (error) {
      warnThrottled('alias flush', error);
    }
  }
}
