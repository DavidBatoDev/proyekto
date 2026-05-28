import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ITasksRepository } from './tasks.repository.interface';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateTaskDto,
  UpdateTaskDto,
  BulkReorderDto,
} from '../dto/roadmaps.dto';

@Injectable()
export class TasksRepositorySupabase implements ITasksRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  private async resolveRoadmapIdByFeature(featureId: string): Promise<string> {
    const { data, error } = await this.db
      .from('roadmap_features')
      .select('roadmap_id')
      .eq('id', featureId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const roadmapId = data?.roadmap_id as string | undefined;
    if (!roadmapId) {
      throw new NotFoundException('Feature not found for task workflow mapping.');
    }
    return roadmapId;
  }

  private async resolveRoadmapIdByTask(taskId: string): Promise<string> {
    const { data, error } = await this.db
      .from('roadmap_tasks')
      .select(
        'feature:roadmap_features!roadmap_tasks_feature_id_fkey(roadmap_id)',
      )
      .eq('id', taskId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data ?? null) as
      | { feature: { roadmap_id: string | null } | null }
      | null;
    const roadmapId = row?.feature?.roadmap_id ?? null;
    if (!roadmapId) {
      throw new NotFoundException('Task roadmap not found.');
    }
    return roadmapId;
  }

  private async resolveColumnById(
    roadmapId: string,
    columnId: string,
  ): Promise<{ id: string; bucket_status: string } | null> {
    const { data, error } = await this.db
      .from('roadmap_workflow_columns')
      .select('id, bucket_status')
      .eq('id', columnId)
      .eq('roadmap_id', roadmapId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { id: string; bucket_status: string } | null) ?? null;
  }

  private async resolveFirstColumnByBucket(
    roadmapId: string,
    bucketStatus: string,
  ): Promise<{ id: string; bucket_status: string } | null> {
    const { data, error } = await this.db
      .from('roadmap_workflow_columns')
      .select('id, bucket_status')
      .eq('roadmap_id', roadmapId)
      .eq('bucket_status', bucketStatus)
      .order('is_system', { ascending: false })
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { id: string; bucket_status: string } | null) ?? null;
  }

  private async normalizeCreateWorkflowCompatibility(
    dto: CreateTaskDto,
  ): Promise<{
    status: string | undefined;
    workflowColumnId: string | undefined;
  }> {
    const roadmapId = await this.resolveRoadmapIdByFeature(dto.feature_id);
    const requestedStatus = dto.status ?? 'todo';

    if (dto.workflow_column_id) {
      const column = await this.resolveColumnById(roadmapId, dto.workflow_column_id);
      if (!column) {
        throw new BadRequestException(
          'workflow_column_id does not belong to this roadmap.',
        );
      }
      return {
        status: column.bucket_status,
        workflowColumnId: column.id,
      };
    }

    const mapped = await this.resolveFirstColumnByBucket(roadmapId, requestedStatus);
    return {
      status: requestedStatus,
      workflowColumnId: mapped?.id,
    };
  }

  private async normalizeUpdateWorkflowCompatibility(
    taskId: string,
    dto: UpdateTaskDto,
  ): Promise<{
    status?: string;
    workflowColumnId?: string | null;
  }> {
    if (
      dto.workflow_column_id === undefined &&
      dto.status === undefined
    ) {
      return {};
    }

    const roadmapId = await this.resolveRoadmapIdByTask(taskId);

    if (dto.workflow_column_id !== undefined) {
      if (!dto.workflow_column_id) {
        return {
          workflowColumnId: null,
          status: dto.status,
        };
      }
      const column = await this.resolveColumnById(roadmapId, dto.workflow_column_id);
      if (!column) {
        throw new BadRequestException(
          'workflow_column_id does not belong to this roadmap.',
        );
      }
      return {
        workflowColumnId: column.id,
        status: column.bucket_status,
      };
    }

    if (dto.status !== undefined) {
      const mapped = await this.resolveFirstColumnByBucket(roadmapId, dto.status);
      return {
        status: dto.status,
        workflowColumnId: mapped?.id ?? null,
      };
    }

    return {};
  }

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
    const compatibility = await this.normalizeCreateWorkflowCompatibility(dto);

    // Only persist columns that exist in roadmap_tasks
    const dbPayload = {
      feature_id: dto.feature_id,
      title: dto.title,
      priority: dto.priority,
      status: compatibility.status,
      workflow_column_id: compatibility.workflowColumnId ?? null,
      assignee_id: dto.assignee_id,
      due_date: dto.due_date,
      position: resolvedPosition,
      work_type: dto.work_type ?? 'real_work',
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
    const compatibility = await this.normalizeUpdateWorkflowCompatibility(id, dto);
    // Only persist columns that exist in roadmap_tasks
    const dbPayload = {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.priority !== undefined && { priority: dto.priority }),
      ...(compatibility.status !== undefined && { status: compatibility.status }),
      ...(compatibility.workflowColumnId !== undefined && {
        workflow_column_id: compatibility.workflowColumnId,
      }),
      ...(dto.assignee_id !== undefined && { assignee_id: dto.assignee_id }),
      ...(dto.position !== undefined && { position: dto.position }),
      ...(dto.due_date !== undefined && { due_date: dto.due_date }),
      ...(dto.completed_at !== undefined && { completed_at: dto.completed_at }),
      ...(dto.work_type !== undefined && { work_type: dto.work_type }),
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
