import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { KnowledgeEmbeddingsService } from './knowledge-embeddings.service';
import type { KnowledgeSourceType } from './knowledge-outbox.service';

const DEFAULT_SEARCH_LIMIT = 12;
const MAX_SEARCH_LIMIT = 20;
const RESULT_CONTENT_MAX_CHARS = 1_500;

export interface KnowledgeSearchParams {
  projectId: string;
  userId: string;
  isGuest: boolean;
  query: string;
  sources?: KnowledgeSourceType[];
  limit?: number;
}

/**
 * Cross-project variant. `projectIds` must already be authorized by the
 * caller (the AI context family intersects them with the user's accessible
 * projects); this service only enforces chat-room visibility.
 */
export interface KnowledgeSearchAcrossProjectsParams {
  projectIds: string[];
  userId: string;
  isGuest: boolean;
  query: string;
  sources?: KnowledgeSourceType[];
  limit?: number;
}

export interface KnowledgeSearchResult {
  id: string;
  source_type: string;
  source_id: string;
  /**
   * Owning project. Surfaced by `searchAcrossProjects` (the projects RPC
   * returns it); absent on the single-project `search`, where the caller
   * already knows it.
   */
  project_id?: string;
  roadmap_id: string | null;
  room_id: string | null;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  score: number;
}

export interface RelevantMemoriesParams {
  roadmapId: string;
  projectId: string | null;
  query: string;
  limit: number;
}

/**
 * Retrieval over ai_knowledge_chunks via the hybrid search SQL function.
 * Chat visibility is enforced HERE, per caller: chat-sourced chunks are
 * filtered to the rooms the user participates in (guests see none) — the
 * table itself is service-role only.
 */
@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly embeddings: KnowledgeEmbeddingsService,
  ) {}

  async search(
    params: KnowledgeSearchParams,
  ): Promise<KnowledgeSearchResult[]> {
    const limit = this.clampLimit(params.limit);
    const roomIds = await this.visibleRoomIds(params);
    const embedding = await this.tryEmbedQuery(params.query);

    const { data, error } = (await this.db.rpc('search_knowledge_chunks', {
      p_project: params.projectId,
      p_embedding: embedding
        ? this.embeddings.toVectorLiteral(embedding)
        : null,
      p_query: params.query,
      p_room_ids: roomIds,
      p_source_types: params.sources?.length ? params.sources : null,
      p_limit: limit,
    })) as { data: unknown; error: { message: string } | null };
    if (error) throw new Error(error.message);

    return this.trimResultContents(data);
  }

  /**
   * `search` over many projects at once, for workspace-scoped AI sessions.
   * Same lanes, same chat-visibility rule (rooms the user participates in
   * across the given projects; guests see none), one RPC. Empty input is a
   * stable empty result without touching the database.
   */
  async searchAcrossProjects(
    params: KnowledgeSearchAcrossProjectsParams,
  ): Promise<KnowledgeSearchResult[]> {
    const projectIds = Array.from(
      new Set(params.projectIds.filter((id) => !!id)),
    );
    if (projectIds.length === 0) return [];

    const limit = this.clampLimit(params.limit);
    const roomIds = await this.visibleRoomIdsAcrossProjects(
      params.userId,
      params.isGuest,
      projectIds,
    );
    const embedding = await this.tryEmbedQuery(params.query);

    const { data, error } = (await this.db.rpc(
      'search_knowledge_chunks_projects',
      {
        p_project_ids: projectIds,
        p_embedding: embedding
          ? this.embeddings.toVectorLiteral(embedding)
          : null,
        p_query: params.query,
        p_room_ids: roomIds,
        p_source_types: params.sources?.length ? params.sources : null,
        p_limit: limit,
      },
    )) as { data: unknown; error: { message: string } | null };
    if (error) throw new Error(error.message);

    return this.trimResultContents(data).map((row) => ({
      ...row,
      project_id:
        typeof row.project_id === 'string' ? row.project_id : undefined,
    }));
  }

  /** Top-k memories by cosine similarity, or null when embeddings are
   * unavailable (caller falls back to the chronological list). */
  async matchRelevantMemories(
    params: RelevantMemoriesParams,
  ): Promise<Record<string, unknown>[] | null> {
    if (!this.embeddings.isEnabled()) return null;
    const embedding = await this.tryEmbedQuery(params.query);
    if (!embedding) return null;

    const { data, error } = (await this.db.rpc('match_relevant_memories', {
      p_roadmap: params.roadmapId,
      p_project: params.projectId,
      p_embedding: this.embeddings.toVectorLiteral(embedding),
      p_limit: Math.min(Math.max(params.limit, 1), 20),
    })) as { data: unknown; error: { message: string } | null };
    if (error) throw new Error(error.message);
    return (data ?? []) as Record<string, unknown>[];
  }

  private async visibleRoomIds(
    params: KnowledgeSearchParams,
  ): Promise<string[]> {
    if (params.isGuest) return [];
    // Participants carry no project column — scope via the rooms join
    // (same shape as ChatRepository.listRoomsForProject).
    const { data, error } = await this.db
      .from('chat_room_participants')
      .select('room_id, chat_rooms!inner(project_id)')
      .eq('user_id', params.userId)
      .eq('chat_rooms.project_id', params.projectId);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((row) => (row as { room_id?: string }).room_id)
      .filter((id): id is string => !!id);
  }

  private async visibleRoomIdsAcrossProjects(
    userId: string,
    isGuest: boolean,
    projectIds: string[],
  ): Promise<string[]> {
    if (isGuest) return [];
    const { data, error } = await this.db
      .from('chat_room_participants')
      .select('room_id, chat_rooms!inner(project_id)')
      .eq('user_id', userId)
      .in('chat_rooms.project_id', projectIds);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((row) => (row as { room_id?: string }).room_id)
      .filter((id): id is string => !!id);
  }

  private clampLimit(limit: number | undefined): number {
    return Math.min(
      Math.max(limit ?? DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT,
    );
  }

  private trimResultContents(data: unknown): KnowledgeSearchResult[] {
    return ((data ?? []) as KnowledgeSearchResult[]).map((row) => ({
      ...row,
      content:
        typeof row.content === 'string' &&
        row.content.length > RESULT_CONTENT_MAX_CHARS
          ? `${row.content.slice(0, RESULT_CONTENT_MAX_CHARS)}…`
          : row.content,
    }));
  }

  private async tryEmbedQuery(query: string): Promise<number[] | null> {
    if (!this.embeddings.isEnabled()) return null;
    try {
      const [vector] = await this.embeddings.embedBatch([query]);
      return vector ?? null;
    } catch (err) {
      // Degrade to the lexical lane rather than failing the search.
      this.logger.warn(
        `query embedding failed, using text-only search: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
