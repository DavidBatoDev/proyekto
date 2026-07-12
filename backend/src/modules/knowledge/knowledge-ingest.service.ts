import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { htmlToText } from '../../common/utils/html-to-text.util';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { chunkText } from './knowledge-chunker';
import { KnowledgeEmbeddingsService } from './knowledge-embeddings.service';
import { KnowledgeOutboxService } from './knowledge-outbox.service';

const CLAIM_BATCH_SIZE = 25;
// Stay comfortably under the global REQUEST_TIMEOUT_MS (25s) so the handler
// returns a 2xx summary instead of being cut off with a 408. The row loop
// also honours this deadline so a claimed batch of slow embed calls can't
// overrun it (Cloud Scheduler's own attempt-deadline is 60s).
const RUN_SOFT_DEADLINE_MS = 20_000;
const ACTIVITY_METADATA_MAX_CHARS = 600;
const BRIEF_MAX_CHARS = 60_000;

interface OutboxRow {
  id: number;
  source_type: string;
  source_id: string;
  project_id: string | null;
  op: 'upsert' | 'delete';
  attempts: number;
}

interface NormalizedSource {
  projectId: string;
  roadmapId: string | null;
  roomId: string | null;
  content: string;
  metadata: Record<string, unknown>;
}

export interface IngestRunResult {
  skipped?: boolean;
  claimed: number;
  processed: number;
  failed: number;
}

/**
 * Outbox poller: claims ingest work, loads + normalizes source rows, chunks,
 * embeds, and upserts ai_knowledge_chunks. project_id/roadmap_id are always
 * re-derived from the source row — the outbox value is advisory. Failures
 * record last_error and stay unprocessed (attempts are stamped at claim time
 * by claim_knowledge_outbox; rows exhaust after 5 attempts and dead-letter in
 * place).
 */
@Injectable()
export class KnowledgeIngestService {
  private readonly logger = new Logger(KnowledgeIngestService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly embeddings: KnowledgeEmbeddingsService,
    private readonly outbox: KnowledgeOutboxService,
  ) {}

  async runIngest(): Promise<IngestRunResult> {
    if (!this.outbox.isEnabled()) {
      return { skipped: true, claimed: 0, processed: 0, failed: 0 };
    }

    const deadline = Date.now() + RUN_SOFT_DEADLINE_MS;
    const totals: IngestRunResult = { claimed: 0, processed: 0, failed: 0 };

    while (Date.now() < deadline) {
      const { data, error } = (await this.db.rpc('claim_knowledge_outbox', {
        p_batch: CLAIM_BATCH_SIZE,
      })) as { data: unknown; error: { message: string } | null };
      if (error) throw new Error(error.message);
      const rows = (Array.isArray(data) ? data : []) as OutboxRow[];
      if (rows.length === 0) break;
      totals.claimed += rows.length;

      for (const row of rows) {
        // Stop mid-batch once the soft deadline passes; any rows left in this
        // claimed batch stay unprocessed and are re-claimed on the next run.
        if (Date.now() >= deadline) break;
        try {
          await this.processRow(row);
          await this.markProcessed(row.id);
          totals.processed += 1;
        } catch (err) {
          totals.failed += 1;
          const message = (err as Error).message ?? 'unknown error';
          this.logger.warn(
            `knowledge_ingest failed ${row.op} ${row.source_type}/${row.source_id}: ${message}`,
          );
          await this.recordFailure(row.id, message);
        }
      }
    }

    return totals;
  }

  private async processRow(row: OutboxRow): Promise<void> {
    if (row.source_type === 'memory') {
      await this.processMemory(row);
      return;
    }

    if (row.op === 'delete') {
      await this.deleteChunks(row.source_type, row.source_id);
      return;
    }

    const source = await this.loadSource(row.source_type, row.source_id);
    if (!source) {
      // Source vanished or became ineligible (deleted chat message, DM,
      // projectless roadmap) — remove anything previously indexed.
      await this.deleteChunks(row.source_type, row.source_id);
      return;
    }

    const chunks = chunkText(source.content);
    if (chunks.length === 0) {
      await this.deleteChunks(row.source_type, row.source_id);
      return;
    }

    const vectors = await this.embeddings.embedBatch(
      chunks.map((chunk) => chunk.content),
    );

    // Delete-then-insert handles shrinking chunk counts under the UNIQUE
    // (source_type, source_id, chunk_index) constraint.
    await this.deleteChunks(row.source_type, row.source_id);
    const { error } = await this.db.from('ai_knowledge_chunks').insert(
      chunks.map((chunk, i) => ({
        project_id: source.projectId,
        roadmap_id: source.roadmapId,
        source_type: row.source_type,
        source_id: row.source_id,
        room_id: source.roomId,
        chunk_index: chunk.index,
        content: chunk.content,
        embedding: vectors[i]
          ? this.embeddings.toVectorLiteral(vectors[i])
          : null,
        metadata: source.metadata,
      })),
    );
    if (error) throw new Error(error.message);
  }

  /** Memories embed in place on roadmap_ai_memories — no chunk rows. */
  private async processMemory(row: OutboxRow): Promise<void> {
    if (row.op === 'delete') return; // forget = is_active flip; nothing to do

    const { data, error } = await this.db
      .from('roadmap_ai_memories')
      .select('id, content, is_active')
      .eq('id', row.source_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const memory = data as { content?: string; is_active?: boolean } | null;
    if (!memory || memory.is_active === false || !memory.content) return;

    const [vector] = await this.embeddings.embedBatch([memory.content]);
    if (!vector) return; // embeddings disabled — text-only lane

    const { error: updateError } = await this.db
      .from('roadmap_ai_memories')
      .update({ embedding: this.embeddings.toVectorLiteral(vector) })
      .eq('id', row.source_id);
    if (updateError) throw new Error(updateError.message);
  }

  private async loadSource(
    sourceType: string,
    sourceId: string,
  ): Promise<NormalizedSource | null> {
    switch (sourceType) {
      case 'chat_message':
        return this.loadChatMessage(sourceId);
      case 'task_comment':
        return this.loadTaskComment(sourceId);
      case 'activity_log':
        return this.loadActivityLog(sourceId);
      case 'brief':
        return this.loadBrief(sourceId);
      default:
        throw new Error(`Unsupported source_type ${sourceType}`);
    }
  }

  private async loadChatMessage(id: string): Promise<NormalizedSource | null> {
    const { data, error } = await this.db
      .from('chat_room_messages')
      .select(
        'id, room_id, project_id, sender_id, content, created_at, deleted_at, ' +
          'sender:profiles!chat_room_messages_sender_id_fkey(display_name), ' +
          'room:chat_rooms!chat_room_messages_room_id_fkey(name, slug)',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as Record<string, unknown> | null;
    // DMs (project_id null) are never ingested; deleted messages un-index.
    if (!row || row.deleted_at || !row.project_id) return null;

    const sender = firstRecord(row.sender);
    const room = firstRecord(row.room);
    return {
      projectId: asText(row.project_id),
      roadmapId: null,
      roomId: row.room_id ? asText(row.room_id) : null,
      content: asText(row.content),
      metadata: {
        sender_id: row.sender_id ?? null,
        sender_name: sender?.display_name ?? null,
        room_slug: room?.slug ?? null,
        room_name: room?.name ?? null,
        sent_at: row.created_at ?? null,
      },
    };
  }

  private async loadTaskComment(id: string): Promise<NormalizedSource | null> {
    const { data, error } = await this.db
      .from('task_comments')
      .select(
        'id, task_id, author_id, content, created_at, ' +
          'task:roadmap_tasks!inner(id, title, ' +
          'feature:roadmap_features!inner(id, ' +
          'epic:roadmap_epics!inner(roadmap_id, ' +
          'roadmap:roadmaps!inner(id, project_id))))',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as Record<string, unknown> | null;
    if (!row) return null;

    const task = firstRecord(row.task);
    const feature = firstRecord(task?.feature);
    const epic = firstRecord(feature?.epic);
    const roadmap = firstRecord(epic?.roadmap);
    const projectId = asText(roadmap?.project_id) || null;
    if (!projectId) return null; // draft/projectless roadmap — not indexed

    return {
      projectId,
      roadmapId: asText(epic?.roadmap_id) || null,
      roomId: null,
      content: htmlToText(asText(row.content), BRIEF_MAX_CHARS),
      metadata: {
        author_id: row.author_id ?? null,
        task_id: row.task_id ?? null,
        task_title: task?.title ?? null,
        commented_at: row.created_at ?? null,
      },
    };
  }

  private async loadActivityLog(id: string): Promise<NormalizedSource | null> {
    const { data, error } = await this.db
      .from('project_activity_log')
      .select(
        'id, project_id, actor_id, action, entity_type, entity_id, metadata, created_at',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as Record<string, unknown> | null;
    if (!row || !row.project_id) return null;

    const detail = compactJson(row.metadata, ACTIVITY_METADATA_MAX_CHARS);
    const content = `${asText(row.action)} ${asText(row.entity_type)}${
      detail ? ` — ${detail}` : ''
    }`.trim();
    return {
      projectId: asText(row.project_id),
      roadmapId: null,
      roomId: null,
      content,
      metadata: {
        actor_id: row.actor_id ?? null,
        action: row.action ?? null,
        entity_type: row.entity_type ?? null,
        entity_id: row.entity_id ?? null,
        logged_at: row.created_at ?? null,
      },
    };
  }

  private async loadBrief(id: string): Promise<NormalizedSource | null> {
    const { data, error } = await this.db
      .from('project_briefs')
      .select('id, project_id, project_summary, custom_fields, version')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as Record<string, unknown> | null;
    if (!row || !row.project_id) return null;

    const parts: string[] = [];
    const summary = htmlToText(asText(row.project_summary), BRIEF_MAX_CHARS);
    if (summary) parts.push(summary);
    if (Array.isArray(row.custom_fields)) {
      for (const raw of row.custom_fields) {
        const field = raw as Record<string, unknown> | null;
        const key = asText(field?.key).trim();
        if (!key) continue;
        const value = htmlToText(asText(field?.value), 2_000);
        parts.push(`${key}: ${value}`);
      }
    }

    return {
      projectId: asText(row.project_id),
      roadmapId: null,
      roomId: null,
      content: parts.join('\n'),
      metadata: { version: row.version ?? null },
    };
  }

  private async deleteChunks(
    sourceType: string,
    sourceId: string,
  ): Promise<void> {
    const { error } = await this.db
      .from('ai_knowledge_chunks')
      .delete()
      .eq('source_type', sourceType)
      .eq('source_id', sourceId);
    if (error) throw new Error(error.message);
  }

  private async markProcessed(outboxId: number): Promise<void> {
    const { error } = await this.db
      .from('ai_knowledge_outbox')
      .update({ processed_at: new Date().toISOString(), last_error: null })
      .eq('id', outboxId);
    if (error) throw new Error(error.message);
  }

  private async recordFailure(
    outboxId: number,
    message: string,
  ): Promise<void> {
    try {
      await this.db
        .from('ai_knowledge_outbox')
        .update({ last_error: message.slice(0, 1_000) })
        .eq('id', outboxId);
    } catch {
      // Never let failure bookkeeping mask the original error.
    }
  }
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const candidate: unknown = Array.isArray(value)
    ? (value as unknown[])[0]
    : value;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as Record<string, unknown>;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function compactJson(value: unknown, maxChars: number): string {
  if (!value || typeof value !== 'object') return '';
  try {
    const text = JSON.stringify(value);
    if (!text || text === '{}') return '';
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  } catch {
    return '';
  }
}
