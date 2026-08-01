import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { KnowledgeOutboxService } from '../knowledge/knowledge-outbox.service';
import {
  type ActivityBuffer,
  type BufferedActivityEntry,
  bufferActivity,
} from '../../common/activity/activity-context';
import { isIndexableAction, isSensitiveAction } from './activity-actions';

export interface AuditEntry {
  projectId: string;
  actorId?: string | null;
  /** Dotted event name, e.g. 'channel.created', 'access.granted'. */
  action: string;
  /** Domain of the affected entity, e.g. 'chat_channel', 'project_access'. */
  entityType: string;
  entityId?: string | null;
  /** Owning roadmap for roadmap-domain events; null for chat/access/member. */
  roadmapId?: string | null;
  metadata?: Record<string, unknown>;
}

const DEFAULT_FLUSH_TIMEOUT_MS = 800;

/**
 * Writes the project-wide activity log that backs the dispute-resolution
 * timeline. `log()` is fire-and-forget — it detaches from the request, never
 * throws, and never adds latency to the caller's response (mirrors the
 * fanoutChat pattern in ChatService). New domains (scope, change requests,
 * file uploads, decisions) call `log()` with their own action/entityType as
 * they land.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    @Optional() private readonly config?: ConfigService,
    // Optional: AuditModule loads before KnowledgeModule in app.module; both
    // are @Global(), but keep audit functional even if knowledge is absent.
    @Optional() private readonly knowledgeOutbox?: KnowledgeOutboxService,
  ) {}

  /**
   * Record one activity row.
   *
   * Inside a request this BUFFERS — the whole request's events go out as one
   * multi-row insert via `flush()`, so a 50-item reorder costs one round-trip
   * instead of fifty. Outside a request (cron, boot, tests) it falls back to
   * the original detached single insert so no caller has to care.
   */
  log(entry: AuditEntry): void {
    const buffered = this.toBufferedEntry(entry);
    if (bufferActivity(buffered)) return;
    void this.insertRows([buffered]).catch(() => {
      /* insertRows already swallows and logs */
    });
  }

  private toBufferedEntry(entry: AuditEntry): BufferedActivityEntry {
    // The id is minted here so the flush can insert with `return=minimal` and
    // still hand the knowledge outbox real row ids without a RETURNING read.
    return { ...entry, id: randomUUID() };
  }

  /**
   * Flush a request's buffer. One insert, no RETURNING, never throws, and
   * bounded by ACTIVITY_FLUSH_TIMEOUT_MS so a slow database cannot hold a
   * response open.
   */
  async flush(store: ActivityBuffer): Promise<void> {
    const entries = store.entries.splice(0, store.entries.length);
    if (store.dropped > 0) {
      // Never silently truncate — a capped request should be visible.
      this.logger.warn(
        `audit_log dropped ${store.dropped} event(s) over the ${store.max}-event per-request cap`,
      );
      store.dropped = 0;
    }
    if (!entries.length) return;

    const timeoutMs = this.flushTimeoutMs();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.insertRows(entries),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private flushTimeoutMs(): number {
    const raw = this.config?.get<string>('ACTIVITY_FLUSH_TIMEOUT_MS');
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_FLUSH_TIMEOUT_MS;
  }

  /** Single multi-row insert. Swallows every failure — audit is best-effort. */
  private async insertRows(entries: BufferedActivityEntry[]): Promise<void> {
    try {
      const { error } = await this.supabase.from('project_activity_log').insert(
        entries.map((entry) => ({
          id: entry.id,
          project_id: entry.projectId,
          actor_id: entry.actorId ?? null,
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId ?? null,
          roadmap_id: entry.roadmapId ?? null,
          is_sensitive: isSensitiveAction(entry.action),
          metadata: entry.metadata ?? {},
        })),
      );
      if (error) {
        this.logger.warn(
          `audit_log insert failed (${entries.length} row(s), actions=${entries
            .map((e) => e.action)
            .join(',')}): ${error.message}`,
        );
        return;
      }

      // Deny-by-default: only a few actions carry enough meaning to embed.
      // Without this, logging every task rename would flood the vector index.
      for (const entry of entries) {
        if (!isIndexableAction(entry.action)) continue;
        this.knowledgeOutbox?.enqueue({
          sourceType: 'activity_log',
          sourceId: entry.id,
          projectId: entry.projectId,
          op: 'upsert',
        });
      }
    } catch (err) {
      this.logger.warn(
        `audit_log insert threw (${entries.length} row(s)): ${(err as Error).message}`,
      );
    }
  }

  /** Read the project timeline. Callers must gate on `logs.view` first. */
  async list(
    projectId: string,
    opts: { limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const { data, error } = await this.supabase
      .from('project_activity_log')
      .select(
        'id, project_id, actor_id, action, entity_type, entity_id, metadata, created_at, ' +
          'actor:profiles!project_activity_log_actor_id_fkey(id, display_name, avatar_url)',
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);
    return data ?? [];
  }
}
