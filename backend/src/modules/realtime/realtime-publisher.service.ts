import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ChatEventKind = 'message' | 'reaction' | 'read';

export interface ChatPublishParams {
  /** Users whose inbox DO should be notified (e.g. room participants). */
  recipientIds: string[];
  roomId: string;
  projectId: string | null;
  kind: ChatEventKind;
}

/**
 * Fans realtime events out to the Cloudflare Worker (`POST /publish`), which
 * forwards them to the per-room Durable Object. Every method is
 * fire-and-forget: it never throws and never blocks the caller's response. If
 * the Worker URL / token aren't configured the publisher is dormant (no-op),
 * so the feature can ship dark.
 *
 * Mirrors the outbound-fetch pattern in CloudflareCachePurgeService
 * (AbortController timeout, warn-on-failure).
 */
@Injectable()
export class RealtimePublisher {
  private readonly logger = new Logger(RealtimePublisher.name);
  private readonly workerUrl?: string;
  private readonly publishToken?: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.workerUrl = this.config.get<string>('REALTIME_WORKER_URL');
    this.publishToken = this.config.get<string>('REALTIME_PUBLISH_TOKEN');
    this.timeoutMs =
      this.config.get<number>('REALTIME_PUBLISH_TIMEOUT_MS') ?? 3000;
  }

  /**
   * Notify everyone viewing a roadmap that its data changed so they refetch.
   * `fromUserId` lets the acting client ignore its own echo (it already applied
   * the change optimistically). Pass null for server-originated edits (AI).
   */
  publishRoadmapChange(roadmapId: string, fromUserId?: string | null): void {
    void this.publish(`roadmap:${roadmapId}`, 'data_changed', {
      from: fromUserId ?? null,
    });
  }

  /** Notify each recipient's inbox DO of a chat change (message/reaction/read). */
  publishChatEvent(params: ChatPublishParams): void {
    const seen = new Set<string>();
    for (const userId of params.recipientIds) {
      if (!userId || seen.has(userId)) continue;
      seen.add(userId);
      void this.publish(`user:${userId}`, 'chat', {
        kind: params.kind,
        roomId: params.roomId,
        projectId: params.projectId,
      });
    }
  }

  private async publish(
    room: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    if (!this.workerUrl || !this.publishToken) return; // dormant until configured

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.workerUrl.replace(/\/$/, '')}/publish`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-realtime-token': this.publishToken,
        },
        body: JSON.stringify({ room, event, payload }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(
          `realtime_publish status=${res.status} room=${room} event=${event}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `realtime_publish failed room=${room} event=${event} error=${
          (error as Error).message
        }`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
