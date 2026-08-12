import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { IMilestonesRepository } from './milestones.repository.interface';
import {
  CreateMilestoneDto,
  UpdateMilestoneDto,
  ReorderDto,
} from '../dto/roadmaps.dto';

@Injectable()
export class MilestonesRepositorySupabase implements IMilestonesRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  private async getNextPosition(roadmapId: string): Promise<number> {
    const { data, error } = await this.db
      .from('roadmap_milestones')
      .select('position')
      .eq('roadmap_id', roadmapId)
      .order('position', { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);

    return (data?.[0]?.position ?? -1) + 1;
  }

  async findByRoadmap(roadmapId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmap_milestones')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async findById(id: string): Promise<any | null> {
    const { data, error } = await this.db
      .from('roadmap_milestones')
      .select('*')
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data ?? null;
  }

  async create(
    roadmapId: string,
    dto: CreateMilestoneDto,
    userId: string,
  ): Promise<any> {
    const requestedPosition = dto.position;
    const resolvedPosition =
      requestedPosition ?? (await this.getNextPosition(roadmapId));

    const { data, error } = await this.db
      .from('roadmap_milestones')
      .insert({ ...dto, roadmap_id: roadmapId, position: resolvedPosition })
      .select()
      .single();

    if (!error) return data;

    const isDuplicatePositionError =
      error.message?.includes('roadmap_milestones_roadmap_id_position_key') ??
      false;

    if (!isDuplicatePositionError) throw new Error(error.message);

    const nextAvailablePosition = await this.getNextPosition(roadmapId);
    const { data: retryData, error: retryError } = await this.db
      .from('roadmap_milestones')
      .insert({
        ...dto,
        roadmap_id: roadmapId,
        position: nextAvailablePosition,
      })
      .select()
      .single();

    if (retryError) throw new Error(retryError.message);

    return retryData;
  }

  async update(id: string, dto: UpdateMilestoneDto): Promise<any> {
    const { data, error } = await this.db
      .from('roadmap_milestones')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async reorder(id: string, dto: ReorderDto): Promise<any> {
    const { data, error } = await this.db
      .from('roadmap_milestones')
      .update({ position: dto.position, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db
      .from('roadmap_milestones')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  }
}
