import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';

export interface AuditEntry {
  projectId: string;
  actorId?: string | null;
  /** Dotted event name, e.g. 'channel.created', 'access.granted'. */
  action: string;
  /** Domain of the affected entity, e.g. 'chat_channel', 'project_access'. */
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

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
  ) {}

  log(entry: AuditEntry): void {
    void (async () => {
      try {
        const { error } = await this.supabase
          .from('project_activity_log')
          .insert({
            project_id: entry.projectId,
            actor_id: entry.actorId ?? null,
            action: entry.action,
            entity_type: entry.entityType,
            entity_id: entry.entityId ?? null,
            metadata: entry.metadata ?? {},
          });
        if (error) {
          this.logger.warn(
            `audit_log failed action=${entry.action}: ${error.message}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `audit_log threw action=${entry.action}: ${(err as Error).message}`,
        );
      }
    })();
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
