import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type { IRoadmapsRepository } from '../repositories/roadmaps.repository.interface';
import { ROADMAPS_REPOSITORY } from './roadmaps.service';
import type {
  CreateRoadmapAiMessageDto,
  CreateRoadmapAiSessionDto,
  ListRoadmapAiMessagesQueryDto,
  ListRoadmapAiSessionsQueryDto,
  RoadmapAiMessageRow,
  RoadmapAiSessionRow,
  UpdateRoadmapAiSessionDto,
} from '../dto/roadmap-ai-sessions.dto';
import { RoadmapAiTitleGeneratorService } from './roadmap-ai-title-generator.service';

// Default cap for seed_messages returned to the client — keeps the Redis
// rehydration payload bounded. The web only pushes these to the agent when a
// cache miss occurs, so the cap also limits planner context size.
const SEED_MESSAGE_LIMIT = 30;
const DEFAULT_HISTORY_LIMIT = 50;

@Injectable()
export class RoadmapAiSessionsService {
  private readonly logger = new Logger(RoadmapAiSessionsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    @Inject(ROADMAPS_REPOSITORY)
    private readonly roadmapsRepo: IRoadmapsRepository,
    private readonly titleGenerator: RoadmapAiTitleGeneratorService,
  ) {}

  // Gate backend access on the same predicate the RLS uses: the caller must
  // be the roadmap owner, a project lead, or a project member. Using the
  // roadmap repo's `findById(id, userId)` delegates to its `canAccessRoadmap`
  // helper so authorization stays in a single place. Returns 404 on denial to
  // avoid leaking existence (matches the private-per-user thread model).
  private async assertCanAccessRoadmap(
    roadmapId: string,
    userId: string,
  ): Promise<void> {
    const roadmap = await this.roadmapsRepo.findById(roadmapId, userId);
    if (!roadmap) {
      throw new NotFoundException('Roadmap not found');
    }
  }

  async list(
    roadmapId: string,
    userId: string,
    query: ListRoadmapAiSessionsQueryDto,
  ): Promise<RoadmapAiSessionRow[]> {
    await this.assertCanAccessRoadmap(roadmapId, userId);

    const wantArchived = query.archived === true;
    const limit = query.limit ?? 50;

    // Sort: pinned first (within pinned, most recently pinned on top), then
    // by last_message_at desc (null-last so brand-new empty sessions still
    // appear near their created_at).
    const { data, error } = await this.db
      .from('roadmap_ai_sessions')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .eq('user_id', userId)
      .eq('is_archived', wantArchived)
      .order('is_pinned', { ascending: false })
      .order('pinned_at', { ascending: false, nullsFirst: false })
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data ?? []) as RoadmapAiSessionRow[];
  }

  async create(
    roadmapId: string,
    userId: string,
    dto: CreateRoadmapAiSessionDto,
  ): Promise<RoadmapAiSessionRow> {
    await this.assertCanAccessRoadmap(roadmapId, userId);

    const { data, error } = await this.db
      .from('roadmap_ai_sessions')
      .insert({
        roadmap_id: roadmapId,
        user_id: userId,
        title: dto.title ?? null,
        mode: dto.mode ?? 'chat',
        // Seed last_message_at with the creation time so a brand-new thread's
        // "activity time" is non-null from the start. The list orders by
        // last_message_at DESC NULLS LAST with limit 50, so without this an
        // empty new thread sinks below every message-bearing thread and, on a
        // busy roadmap, falls off the limit and never shows in the picker. The
        // message-insert trigger overwrites this on the first real message.
        last_message_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as RoadmapAiSessionRow;
  }

  async getById(
    roadmapId: string,
    sessionId: string,
    userId: string,
  ): Promise<RoadmapAiSessionRow> {
    // Auth check by roadmap covers "can this user be seeing this roadmap at
    // all"; the user_id equality below enforces private-per-user ownership.
    // Cross-user reads return 404 (not 403) to avoid leaking existence.
    await this.assertCanAccessRoadmap(roadmapId, userId);

    const { data, error } = await this.db
      .from('roadmap_ai_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('roadmap_id', roadmapId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('AI session not found');
    return data as RoadmapAiSessionRow;
  }

  async update(
    roadmapId: string,
    sessionId: string,
    userId: string,
    dto: UpdateRoadmapAiSessionDto,
  ): Promise<RoadmapAiSessionRow> {
    // Verify ownership before mutation.
    await this.getById(roadmapId, sessionId, userId);

    // Build patch with only defined fields so we don't stomp unset columns.
    const patch: Record<string, unknown> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.is_archived !== undefined) patch.is_archived = dto.is_archived;
    if (dto.is_pinned !== undefined) patch.is_pinned = dto.is_pinned;

    if (Object.keys(patch).length === 0) {
      return this.getById(roadmapId, sessionId, userId);
    }

    const { data, error } = await this.db
      .from('roadmap_ai_sessions')
      .update(patch)
      .eq('id', sessionId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as RoadmapAiSessionRow;
  }

  /** Persist the agent's memory-class session snapshot (pending plan, undo
   * log, recents, conversation summary) under metadata.agent_state. Written
   * fire-and-forget by the agent after turns that changed memory state;
   * replayed into the agent's Redis session on rehydration. */
  async updateAgentState(
    roadmapId: string,
    sessionId: string,
    userId: string,
    agentState: Record<string, unknown>,
  ): Promise<void> {
    const session = await this.getById(roadmapId, sessionId, userId);

    const serialized = JSON.stringify(agentState);
    if (serialized.length > 65_536) {
      throw new BadRequestException({
        message: 'Agent state snapshot exceeds the 64KB limit',
        code: 'AGENT_STATE_TOO_LARGE',
      });
    }

    // Merge, don't replace: keep any future metadata siblings intact.
    const existingMetadata =
      session.metadata && typeof session.metadata === 'object'
        ? (session.metadata as Record<string, unknown>)
        : {};
    const { error } = await this.db
      .from('roadmap_ai_sessions')
      .update({ metadata: { ...existingMetadata, agent_state: agentState } })
      .eq('id', sessionId)
      .eq('user_id', userId);

    if (error) throw new Error(error.message);
  }

  async delete(
    roadmapId: string,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    await this.getById(roadmapId, sessionId, userId);

    const { error } = await this.db
      .from('roadmap_ai_sessions')
      .delete()
      .eq('id', sessionId)
      .eq('user_id', userId);

    if (error) throw new Error(error.message);
  }

  async listMessages(
    roadmapId: string,
    sessionId: string,
    userId: string,
    query: ListRoadmapAiMessagesQueryDto,
  ): Promise<RoadmapAiMessageRow[]> {
    await this.getById(roadmapId, sessionId, userId);

    const limit = query.limit ?? DEFAULT_HISTORY_LIMIT;

    if (query.after_seq !== undefined) {
      // Forward pagination (ascending) — used by the web's streaming update
      // path if we ever add one. Today the panel just reloads on thread
      // switch, so this is a nice-to-have.
      const { data, error } = await this.db
        .from('roadmap_ai_messages')
        .select('*')
        .eq('session_id', sessionId)
        .gt('seq', query.after_seq)
        .order('seq', { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as RoadmapAiMessageRow[];
    }

    // Default: fetch the most recent `limit` messages, then sort ascending so
    // the panel renders them in chronological order.
    let request = this.db
      .from('roadmap_ai_messages')
      .select('*')
      .eq('session_id', sessionId);
    if (query.before_seq !== undefined) {
      request = request.lt('seq', query.before_seq);
    }
    const { data, error } = await request
      .order('seq', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RoadmapAiMessageRow[];
    return rows.sort((a, b) => a.seq - b.seq);
  }

  async appendMessage(
    roadmapId: string,
    sessionId: string,
    userId: string,
    dto: CreateRoadmapAiMessageDto,
  ): Promise<{
    message: RoadmapAiMessageRow;
    seed_messages: { role: string; content: string }[];
  }> {
    const session = await this.getById(roadmapId, sessionId, userId);

    const { data, error } = await this.db
      .from('roadmap_ai_messages')
      .insert({
        session_id: sessionId,
        role: dto.role,
        content: dto.content,
        intent_type: dto.intent_type ?? null,
        response_mode: dto.response_mode ?? null,
        parse_mode: dto.parse_mode ?? null,
        artifacts: dto.artifacts ?? null,
        activity_timeline: dto.activity_timeline ?? null,
        commit_lifecycle: dto.commit_lifecycle ?? null,
        tokens: dto.tokens ?? null,
        metadata: dto.metadata ?? {},
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    const message = data as RoadmapAiMessageRow;

    // Return the last N messages so the web can pass them as seed_messages
    // to the agent on Redis TTL expiry. Includes the just-inserted row.
    const seedMessages = await this.loadSeedMessages(sessionId);

    // Fire-and-forget title generation after the first assistant reply — the
    // DB trigger has already incremented message_count by 1, so msg_count==2
    // means "user turn + first assistant turn" just landed.
    if (
      dto.role === 'assistant' &&
      session.message_count === 1 &&
      !session.title
    ) {
      this.titleGenerator
        .enqueue(sessionId)
        .catch((err: unknown) =>
          this.logger.warn(
            `Title generation kickoff failed for session ${sessionId}: ${
              (err as Error)?.message ?? 'unknown error'
            }`,
          ),
        );
    }

    return { message, seed_messages: seedMessages };
  }

  private async loadSeedMessages(
    sessionId: string,
  ): Promise<{ role: string; content: string }[]> {
    const { data, error } = await this.db
      .from('roadmap_ai_messages')
      .select('role, content, seq')
      .eq('session_id', sessionId)
      .order('seq', { ascending: false })
      .limit(SEED_MESSAGE_LIMIT);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { role: string; content: string; seq: number }[];
    return rows
      .sort((a, b) => a.seq - b.seq)
      .map(({ role, content }) => ({ role, content }));
  }
}
