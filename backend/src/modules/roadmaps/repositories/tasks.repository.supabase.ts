import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ITasksRepository } from './tasks.repository.interface';
import {
  CreateTaskDto,
  UpdateTaskDto,
  BulkReorderDto,
} from '../dto/roadmaps.dto';

@Injectable()
export class TasksRepositorySupabase implements ITasksRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  private async getNextPosition(featureId: string): Promise<number> {
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .select('position')
      .eq('feature_id', featureId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw new Error(error.message);
    }

    return typeof data?.position === 'number' ? data.position + 1 : 0;
  }

  async findByFeature(featureId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .select(
        '*, assignee:profiles(id, display_name, avatar_url, email, first_name, last_name)',
      )
      .eq('feature_id', featureId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async findByRoadmap(roadmapId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .select(
        `*,
         assignee:profiles(id, display_name, avatar_url, email, first_name, last_name),
         feature:roadmap_features!inner(
           id,
           title,
           roadmap_id,
           epic_id,
           epic:roadmap_epics(id, title, color),
           milestone_features(milestone_id)
         )`,
      )
      .eq('feature.roadmap_id', roadmapId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async findById(id: string): Promise<any | null> {
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .select(
        '*, assignee:profiles(id, display_name, avatar_url, email, first_name, last_name)',
      )
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data ?? null;
  }

  async create(dto: CreateTaskDto, userId: string): Promise<any> {
    const resolvedPosition =
      typeof dto.position === 'number'
        ? dto.position
        : await this.getNextPosition(dto.feature_id);

    // Only persist columns that exist in roadmap_tasks
    const dbPayload = {
      feature_id: dto.feature_id,
      title: dto.title,
      priority: dto.priority,
      status: dto.status,
      assignee_id: dto.assignee_id,
      due_date: dto.due_date,
      position: resolvedPosition,
    };
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .insert(dbPayload)
      .select(
        '*, assignee:profiles(id, display_name, avatar_url, email, first_name, last_name)',
      )
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, dto: UpdateTaskDto): Promise<any> {
    // Only persist columns that exist in roadmap_tasks
    const dbPayload = {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.priority !== undefined && { priority: dto.priority }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.assignee_id !== undefined && { assignee_id: dto.assignee_id }),
      ...(dto.position !== undefined && { position: dto.position }),
      ...(dto.due_date !== undefined && { due_date: dto.due_date }),
      ...(dto.completed_at !== undefined && { completed_at: dto.completed_at }),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .update(dbPayload)
      .eq('id', id)
      .select(
        '*, assignee:profiles(id, display_name, avatar_url, email, first_name, last_name)',
      )
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async bulkReorder(featureId: string, dto: BulkReorderDto): Promise<void> {
    const updates = dto.items.map((item) =>
      this.db
        .from('roadmap_tasks')
        .update({
          position: item.position,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)
        .eq('feature_id', featureId),
    );
    const results = await Promise.all(updates);
    for (const { error } of results) {
      if (error) throw new Error(error.message);
    }
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from('roadmap_tasks').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}
