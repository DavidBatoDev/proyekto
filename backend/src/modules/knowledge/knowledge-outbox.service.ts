import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';

export const KNOWLEDGE_SOURCE_TYPES = [
  'chat_message',
  'task_comment',
  'activity_log',
  'brief',
  'memory',
  'file_chunk',
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export interface KnowledgeOutboxEntry {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  /** Advisory only — the ingest worker re-derives it from the source row. */
  projectId?: string | null;
  op: 'upsert' | 'delete';
}

/**
 * Enqueues ingest work for the knowledge pipeline. `enqueue()` is
 * fire-and-forget — detached from the request, never throws, never adds
 * latency (mirrors AuditService.log). A no-op while KNOWLEDGE_INGEST_ENABLED
 * is off, so the feature has zero write-path footprint until enabled; the
 * backfill script covers history at enable time.
 */
@Injectable()
export class KnowledgeOutboxService {
  private readonly logger = new Logger(KnowledgeOutboxService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    const flag = this.config.get<string>('KNOWLEDGE_INGEST_ENABLED');
    return flag === 'true' || flag === '1';
  }

  enqueue(entry: KnowledgeOutboxEntry): void {
    if (!this.isEnabled()) return;
    void (async () => {
      try {
        const { error } = await this.supabase
          .from('ai_knowledge_outbox')
          .insert({
            source_type: entry.sourceType,
            source_id: entry.sourceId,
            project_id: entry.projectId ?? null,
            op: entry.op,
          });
        if (error) {
          this.logger.warn(
            `knowledge_outbox failed ${entry.op} ${entry.sourceType}/${entry.sourceId}: ${error.message}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `knowledge_outbox threw ${entry.op} ${entry.sourceType}/${entry.sourceId}: ${(err as Error).message}`,
        );
      }
    })();
  }
}
