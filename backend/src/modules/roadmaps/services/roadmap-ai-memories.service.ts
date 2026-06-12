import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type { IRoadmapsRepository } from '../repositories/roadmaps.repository.interface';
import { ROADMAPS_REPOSITORY } from './roadmaps.service';
import type {
  CreateRoadmapAiMemoryDto,
  RoadmapAiMemoryRow,
} from '../dto/roadmap-ai-memories.dto';

// Hard cap on active notes per roadmap — the agent injects all of them into
// every turn's prompt, so unbounded growth degrades quality and cost.
const ACTIVE_MEMORY_LIMIT = 50;

/** Long-term roadmap AI memory: durable preferences/conventions, shared by
 * every collaborator on the roadmap (chat-managed; endpoints are UI-ready). */
@Injectable()
export class RoadmapAiMemoriesService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    @Inject(ROADMAPS_REPOSITORY)
    private readonly roadmapsRepo: IRoadmapsRepository,
  ) {}

  // Shared-per-roadmap model: any collaborator who can access the roadmap can
  // list/create/forget memories. 404 on denial to avoid leaking existence.
  private async assertCanAccessRoadmap(
    roadmapId: string,
    userId: string,
  ): Promise<void> {
    const roadmap = await this.roadmapsRepo.findById(roadmapId, userId);
    if (!roadmap) {
      throw new NotFoundException('Roadmap not found');
    }
  }

  async list(roadmapId: string, userId: string): Promise<RoadmapAiMemoryRow[]> {
    await this.assertCanAccessRoadmap(roadmapId, userId);

    const { data, error } = await this.db
      .from('roadmap_ai_memories')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []) as RoadmapAiMemoryRow[];
  }

  async create(
    roadmapId: string,
    userId: string,
    dto: CreateRoadmapAiMemoryDto,
  ): Promise<RoadmapAiMemoryRow> {
    await this.assertCanAccessRoadmap(roadmapId, userId);

    const { count, error: countError } = await this.db
      .from('roadmap_ai_memories')
      .select('id', { count: 'exact', head: true })
      .eq('roadmap_id', roadmapId)
      .eq('is_active', true);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= ACTIVE_MEMORY_LIMIT) {
      throw new BadRequestException({
        message: `This roadmap already has ${ACTIVE_MEMORY_LIMIT} active memories; forget one before saving another`,
        code: 'MEMORY_LIMIT_REACHED',
      });
    }

    const { data, error } = await this.db
      .from('roadmap_ai_memories')
      .insert({
        roadmap_id: roadmapId,
        content: dto.content,
        source: dto.source ?? 'user_request',
        created_by: userId,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as RoadmapAiMemoryRow;
  }

  /** Soft delete — keeps "recently forgotten / undo" cheap for a later UI. */
  async deactivate(
    roadmapId: string,
    memoryId: string,
    userId: string,
  ): Promise<void> {
    await this.assertCanAccessRoadmap(roadmapId, userId);

    const { data, error } = await this.db
      .from('roadmap_ai_memories')
      .update({ is_active: false })
      .eq('id', memoryId)
      .eq('roadmap_id', roadmapId)
      .eq('is_active', true)
      .select('id');

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      throw new NotFoundException('Memory not found');
    }
  }
}
