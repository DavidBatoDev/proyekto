import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { KnowledgeOutboxService } from '../../knowledge/knowledge-outbox.service';
import { KnowledgeSearchService } from '../../knowledge/knowledge-search.service';
import type { IRoadmapsRepository } from '../repositories/roadmaps.repository.interface';
import { ROADMAPS_REPOSITORY } from './roadmaps.service';
import type {
  CreateRoadmapAiMemoryDto,
  RoadmapAiMemoryRow,
  RoadmapAiRelevantMemoryRow,
} from '../dto/roadmap-ai-memories.dto';

// Hard cap on active notes per scope bucket — the agent injects all of them
// into every turn's prompt (until the semantic-retrieval threshold), so
// unbounded growth degrades quality and cost.
const ACTIVE_MEMORY_LIMIT = 50;

// Explicit column list: the embedding vector (1536 floats, Phase 3) must
// never ride list/create responses.
const MEMORY_COLUMNS =
  'id, roadmap_id, project_id, scope, category, content, source, ' +
  'created_by, is_active, created_at, updated_at';

type RoadmapMemoryMeta = {
  roadmapId: string;
  projectId: string | null;
};

/** Long-term roadmap AI memory: durable preferences/conventions, shared by
 * every collaborator on the roadmap (chat-managed; endpoints are UI-ready).
 * scope='project' rows are additionally visible from every roadmap of the
 * same project. */
@Injectable()
export class RoadmapAiMemoriesService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    @Inject(ROADMAPS_REPOSITORY)
    private readonly roadmapsRepo: IRoadmapsRepository,
    private readonly knowledgeOutbox: KnowledgeOutboxService,
    private readonly knowledgeSearch: KnowledgeSearchService,
  ) {}

  // Shared-per-roadmap model: any collaborator who can access the roadmap can
  // list/create/forget memories. 404 on denial to avoid leaking existence.
  // Returns the roadmap's project linkage so scope queries need no re-fetch.
  private async assertCanAccessRoadmap(
    roadmapId: string,
    userId: string,
  ): Promise<RoadmapMemoryMeta> {
    const roadmap = (await this.roadmapsRepo.findById(roadmapId, userId)) as {
      project_id?: string | null;
    } | null;
    if (!roadmap) {
      throw new NotFoundException('Roadmap not found');
    }
    const projectId =
      typeof roadmap.project_id === 'string' && roadmap.project_id
        ? roadmap.project_id
        : null;
    return { roadmapId, projectId };
  }

  private scopePredicate(meta: RoadmapMemoryMeta): string {
    // Roadmap-scope rows saved here OR project-scope rows of this project.
    if (!meta.projectId) {
      return `and(roadmap_id.eq.${meta.roadmapId},scope.eq.roadmap)`;
    }
    return (
      `and(roadmap_id.eq.${meta.roadmapId},scope.eq.roadmap),` +
      `and(project_id.eq.${meta.projectId},scope.eq.project)`
    );
  }

  async list(roadmapId: string, userId: string): Promise<RoadmapAiMemoryRow[]> {
    const meta = await this.assertCanAccessRoadmap(roadmapId, userId);

    const { data, error } = await this.db
      .from('roadmap_ai_memories')
      .select(MEMORY_COLUMNS)
      .or(this.scopePredicate(meta))
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as RoadmapAiMemoryRow[];
  }

  async create(
    roadmapId: string,
    userId: string,
    dto: CreateRoadmapAiMemoryDto,
  ): Promise<RoadmapAiMemoryRow> {
    const meta = await this.assertCanAccessRoadmap(roadmapId, userId);
    const scope = dto.scope ?? 'roadmap';
    if (scope === 'project' && !meta.projectId) {
      throw new BadRequestException({
        message:
          'This roadmap is not linked to a project; save the memory with roadmap scope instead',
        code: 'NO_PROJECT_FOR_SCOPE',
      });
    }

    // Limit is per scope bucket: 50 roadmap-scope notes here plus 50
    // project-scope notes for the project.
    let countQuery = this.db
      .from('roadmap_ai_memories')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('scope', scope);
    countQuery =
      scope === 'project'
        ? countQuery.eq('project_id', meta.projectId as string)
        : countQuery.eq('roadmap_id', roadmapId);
    const { count, error: countError } = await countQuery;
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= ACTIVE_MEMORY_LIMIT) {
      throw new BadRequestException({
        message: `This ${scope} already has ${ACTIVE_MEMORY_LIMIT} active memories; forget one before saving another`,
        code: 'MEMORY_LIMIT_REACHED',
      });
    }

    const { data, error } = await this.db
      .from('roadmap_ai_memories')
      .insert({
        roadmap_id: roadmapId,
        project_id: meta.projectId,
        scope,
        category: dto.category ?? 'preference',
        content: dto.content,
        source: dto.source ?? 'user_request',
        created_by: userId,
      })
      .select(MEMORY_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    const row = data as unknown as RoadmapAiMemoryRow;

    // Fire-and-forget: the ingest worker embeds the content onto the row for
    // semantic retrieval. No-op while KNOWLEDGE_INGEST_ENABLED is off.
    this.knowledgeOutbox.enqueue({
      sourceType: 'memory',
      sourceId: row.id,
      projectId: row.project_id,
      op: 'upsert',
    });

    return row;
  }

  /** Top-k memories semantically relevant to a query. Falls back to the
   * plain chronological list when embeddings are unavailable, so the
   * endpoint never breaks while the knowledge pipeline is dark. */
  async relevant(
    roadmapId: string,
    userId: string,
    query: string,
    limit: number,
  ): Promise<{ memories: RoadmapAiRelevantMemoryRow[] }> {
    const meta = await this.assertCanAccessRoadmap(roadmapId, userId);

    const matched = await this.knowledgeSearch.matchRelevantMemories({
      roadmapId: meta.roadmapId,
      projectId: meta.projectId,
      query,
      limit,
    });
    if (matched && matched.length > 0) {
      return {
        memories: matched as unknown as RoadmapAiRelevantMemoryRow[],
      };
    }

    const all = await this.list(roadmapId, userId);
    return { memories: all.slice(0, limit) };
  }

  /** Soft delete — keeps "recently forgotten / undo" cheap for a later UI. */
  async deactivate(
    roadmapId: string,
    memoryId: string,
    userId: string,
  ): Promise<void> {
    const meta = await this.assertCanAccessRoadmap(roadmapId, userId);

    // Forgetting must also work on project-scope rows saved from a sibling
    // roadmap, so the row filter mirrors list()'s visibility.
    const { data, error } = await this.db
      .from('roadmap_ai_memories')
      .update({ is_active: false })
      .eq('id', memoryId)
      .or(this.scopePredicate(meta))
      .eq('is_active', true)
      .select('id');

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new NotFoundException('Memory not found');
    }
  }
}
