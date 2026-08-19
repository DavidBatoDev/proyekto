import { Injectable } from '@nestjs/common';
import { RealtimePublisher } from '../../../shared/realtime/realtime-publisher.service';
import {
  RoadmapActivityService,
  type ActivityEvent,
} from './roadmap-activity.service';
import type { RoadmapWriteContext } from './roadmap-authorization.service';

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
  constructor(
    private readonly realtime: RealtimePublisher,
    private readonly activity: RoadmapActivityService,
  ) {}

  /** Realtime only — for writes with nothing worth logging. */
  touch(ctx: RoadmapWriteContext | null | undefined, actorId: string): void {
    if (ctx?.roadmapId) {
      this.realtime.publishRoadmapChange(ctx.roadmapId, actorId);
    }
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
