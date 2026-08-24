import { Injectable } from '@nestjs/common';
import { RedisCacheInvalidationService } from '../../../../common/cache/redis-cache-invalidation.service';
import { RealtimePublisher } from '../../../shared/realtime/realtime-publisher.service';
import {
  RoadmapActivityService,
  type ActivityEvent,
} from './roadmap-activity.service';
import type { RoadmapWriteContext } from './roadmap-authorization.service';

// Dashboard cards embed a roadmap_summary (counts + cascade progress), so any
// canvas-changing write stales every member's cached dashboard. Busting is
// throttled because AI patch commits and drag bursts fire many writes in a
// row — one clear per window is enough, and the cache's own 15s TTL self-heals
// whatever a suppressed bust would have caught.
const DASHBOARD_BUST_THROTTLE_MS = 2_000;

/**
 * The single post-write side-effect seam for roadmap mutations: publish the
 * realtime change and record activity, both driven off the scope the
 * authorization walk already resolved.
 *
 * Replaces the four byte-identical private `notify()` helpers that lived in
 * EpicsService / FeaturesService / MilestonesService / TasksService, and gives
 * TaskExtrasService and RoadmapsService the realtime publish they never had.
 *
 * Deliberately an injectable collaborator rather than a base class: a Nest base
 * class would force every write service's constructor to forward its deps
 * through super(), which is worse than the duplication it removes.
 *
 * Never throws. Both effects are best-effort by design — a failed realtime
 * publish or audit row must not fail a write that already succeeded.
 */
@Injectable()
export class RoadmapWriteEffects {
  private lastDashboardBustAt = 0;

  constructor(
    private readonly realtime: RealtimePublisher,
    private readonly activity: RoadmapActivityService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
  ) {}

  /** Realtime only — for writes with nothing worth logging. */
  touch(ctx: RoadmapWriteContext | null | undefined, actorId: string): void {
    if (ctx?.roadmapId) {
      this.realtime.publishRoadmapChange(ctx.roadmapId, actorId);
      this.bustDashboardCache();
    }
  }

  /**
   * Fire-and-forget, throttled. invalidateAllDashboardCache swallows Redis
   * errors internally, so this keeps the class's never-throws contract.
   */
  private bustDashboardCache(): void {
    const now = Date.now();
    if (now - this.lastDashboardBustAt < DASHBOARD_BUST_THROTTLE_MS) return;
    this.lastDashboardBustAt = now;
    void this.cacheInvalidation.invalidateAllDashboardCache();
  }

  /** Realtime publish + activity row(s). */
  emit(
    ctx: RoadmapWriteContext | null | undefined,
    actorId: string,
    events: ActivityEvent | ActivityEvent[],
  ): void {
    this.touch(ctx, actorId);
    this.activity.record(ctx, actorId, events);
  }

  /**
   * Activity only — for writes whose realtime notification is handled
   * elsewhere, or that genuinely do not change the canvas (attachments,
   * dependencies).
   *
   * Comments used to be listed here. They are not any more: the canvas gained
   * comment-count badges and hover previews, so a new comment changes what
   * every collaborator sees and the three addComment paths use `emit`.
   */
  record(
    ctx: RoadmapWriteContext | null | undefined,
    actorId: string,
    events: ActivityEvent | ActivityEvent[],
  ): void {
    this.activity.record(ctx, actorId, events);
  }
}
