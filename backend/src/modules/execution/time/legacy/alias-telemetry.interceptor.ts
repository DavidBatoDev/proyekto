// backend/src/modules/execution/time/legacy/alias-telemetry.interceptor.ts
//
// D30 (critic CC12): who still calls /api/team-time, per route and day, so the alias can be retired (M5 / L18).
// Hits are counted in process and flushed once a minute per instance (and at shutdown) as one Redis pipeline of
// INCRBY <n> + EXPIRE per key on time:alias:hits:<routeId>:<yyyymmdd>, with one structured log line per route.
// A per-hit pipeline would cost two Upstash commands per `logs/me/running` poll (every 3 s while a timer runs,
// every 30 s idle, per signed-in user). Null Redis is a no-op (TimeCacheService). The count happens before the
// handler runs, after the guards: 410s and 400s count, a guard's 401/404 does not.
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  OnApplicationShutdown,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import {
  type AliasHitCount,
  aliasHitsDay,
  TimeCacheService,
} from '../time-cache';

export const ALIAS_ROUTE_KEY = 'time:alias-route';
/** The alias route id (blueprint §4 "Route id"), read by AliasTelemetryInterceptor. */
export const AliasRoute = (routeId: string) =>
  SetMetadata(ALIAS_ROUTE_KEY, routeId);

/** One flush per minute per instance (D30). */
export const ALIAS_FLUSH_INTERVAL_MS = 60_000;

@Injectable()
export class AliasTelemetryInterceptor
  implements NestInterceptor, OnApplicationShutdown
{
  private readonly logger = new Logger('TeamTimeAlias');
  /** Buffered hits keyed `<routeId>|<yyyymmdd>`. */
  private readonly counts = new Map<string, AliasHitCount>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly cache: TimeCacheService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const routeId = this.reflector.get<string | undefined>(
      ALIAS_ROUTE_KEY,
      context.getHandler(),
    );
    if (routeId) this.record(routeId);
    return next.handle();
  }

  /** Counts one hit in process; starts the flush timer on the first hit. Never touches Redis. */
  record(routeId: string, at: Date = new Date()): void {
    const day = aliasHitsDay(at);
    const key = `${routeId}|${day}`;
    const hit = this.counts.get(key);
    if (hit) hit.count += 1;
    else this.counts.set(key, { routeId, day, count: 1 });
    this.startTimer();
  }

  /** The buffered counts not yet flushed (test seam and diagnostics). */
  pending(): AliasHitCount[] {
    return [...this.counts.values()].map((c) => ({ ...c }));
  }

  /**
   * Takes the buffer, logs `{evt:'team_time_alias', route, count_since_last}` once per route and sends one
   * pipeline through TimeCacheService.flushAliasHits (INCRBY + EXPIRE per key). Never throws; an empty buffer
   * sends nothing.
   */
  async flush(): Promise<void> {
    if (this.counts.size === 0) return;
    const batch = [...this.counts.values()];
    this.counts.clear();
    const perRoute = new Map<string, number>();
    for (const c of batch) {
      perRoute.set(c.routeId, (perRoute.get(c.routeId) ?? 0) + c.count);
    }
    for (const [route, count] of perRoute) {
      this.logger.log(
        JSON.stringify({
          evt: 'team_time_alias',
          route,
          count_since_last: count,
        }),
      );
    }
    try {
      await this.cache.flushAliasHits(batch);
    } catch (error) {
      // flushAliasHits never throws; this only guards a replaced implementation.
      this.logger.warn(
        `team-time alias flush failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** The last flush of an instance (app.enableShutdownHooks is on in main.ts). */
  async onApplicationShutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, ALIAS_FLUSH_INTERVAL_MS);
    // Never keep the process (or a test run) alive for telemetry.
    const handle = this.timer as { unref?: () => void };
    handle.unref?.();
  }
}
