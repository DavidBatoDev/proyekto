import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { NotificationsService } from '../../notifications/notifications.service';
import type { ITasksRepository } from '../repositories/tasks.repository.interface';
import {
  CreateTaskDto,
  QuickCreateTaskFromTimerDto,
  UpdateTaskDto,
  BulkReorderDto,
} from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';

export const TASKS_REPOSITORY = Symbol('TASKS_REPOSITORY');

@Injectable()
export class TasksService {
  constructor(
    @Inject(TASKS_REPOSITORY) private readonly repo: ITasksRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly notifications: NotificationsService,
  ) {}

  async findByFeature(featureId: string) {
    return this.repo.findByFeature(featureId);
  }

  async findByRoadmap(roadmapId: string) {
    return this.repo.findByRoadmap(roadmapId);
  }

  async findById(id: string) {
    const task = await this.repo.findById(id);
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async create(dto: CreateTaskDto, userId: string) {
    await this.roadmapAuthz.assertFeaturePermission(
      dto.feature_id,
      userId,
      'roadmap.create_tasks',
    );
    const task = await this.repo.create(dto, userId);
    await this.notifyTaskAssignee(task, userId);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return task;
  }

  async quickCreateFromTimer(dto: QuickCreateTaskFromTimerDto, userId: string) {
    await this.roadmapAuthz.assertProjectRoadmapPermission(
      dto.project_id,
      userId,
      'roadmap.create_tasks',
    );

    const featureId = await this.ensureTimerFeature(dto.project_id, userId);
    const task = await this.repo.create(
      {
        feature_id: featureId,
        title: dto.title.trim(),
        priority: 'medium',
        status: 'todo',
        assignee_id: dto.assignee_id,
        due_date: dto.due_date,
        work_type: dto.work_type ?? 'real_work',
      },
      userId,
    );
    await this.notifyTaskAssignee(task, userId);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return task;
  }

  async update(id: string, dto: UpdateTaskDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    await this.roadmapAuthz.assertTaskPermission(id, userId, 'roadmap.edit_tasks');
    const task = await this.repo.update(id, dto);
    const previousAssignee = existing.assignee_id ?? null;
    const nextAssignee = task?.assignee_id ?? null;
    if (nextAssignee && nextAssignee !== previousAssignee) {
      await this.notifyTaskAssignee(task, userId);
    }
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return task;
  }

  async bulkReorder(featureId: string, dto: BulkReorderDto, userId: string) {
    await this.roadmapAuthz.assertFeaturePermission(
      featureId,
      userId,
      'roadmap.edit_tasks',
    );
    const reordered = await this.repo.bulkReorder(featureId, dto);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    return reordered;
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    await this.roadmapAuthz.assertTaskPermission(id, userId, 'roadmap.edit_tasks');
    await this.repo.remove(id);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
  }

  private async ensureTimerFeature(
    projectId: string,
    userId: string,
  ): Promise<string> {
    const { data: existingRoadmap, error: roadmapErr } = await this.db
      .from('roadmaps')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (roadmapErr) throw new Error(roadmapErr.message);

    let roadmapId = existingRoadmap?.id as string | undefined;
    if (!roadmapId) {
      const { data: createdRoadmap, error: createRoadmapErr } = await this.db
        .from('roadmaps')
        .insert({
          project_id: projectId,
          owner_id: userId,
          name: 'Project roadmap',
          status: 'draft',
        })
        .select('id')
        .single();
      if (createRoadmapErr || !createdRoadmap) {
        throw new Error(
          createRoadmapErr?.message ?? 'Failed to create default roadmap',
        );
      }
      roadmapId = createdRoadmap.id as string;
    }

    const { data: existingEpic, error: epicErr } = await this.db
      .from('roadmap_epics')
      .select('id')
      .eq('roadmap_id', roadmapId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (epicErr) throw new Error(epicErr.message);

    let epicId = existingEpic?.id as string | undefined;
    if (!epicId) {
      const { data: createdEpic, error: createEpicErr } = await this.db
        .from('roadmap_epics')
        .insert({
          roadmap_id: roadmapId,
          title: 'General',
          status: 'backlog',
          priority: 'medium',
          position: 0,
        })
        .select('id')
        .single();
      if (createEpicErr || !createdEpic) {
        throw new Error(createEpicErr?.message ?? 'Failed to create default epic');
      }
      epicId = createdEpic.id as string;
    }

    const { data: existingFeature, error: featureErr } = await this.db
      .from('roadmap_features')
      .select('id')
      .eq('epic_id', epicId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (featureErr) throw new Error(featureErr.message);
    if (existingFeature?.id) return existingFeature.id as string;

    const { data: createdFeature, error: createFeatureErr } = await this.db
      .from('roadmap_features')
      .insert({
        epic_id: epicId,
        title: 'General',
        position: 0,
      })
      .select('id')
      .single();
    if (createFeatureErr || !createdFeature) {
      throw new Error(
        createFeatureErr?.message ?? 'Failed to create default feature',
      );
    }
    return createdFeature.id as string;
  }

  private async notifyTaskAssignee(task: any, actorId: string): Promise<void> {
    const assigneeId =
      typeof task?.assignee_id === 'string' ? task.assignee_id : null;
    if (!assigneeId || assigneeId === actorId) return;

    const title =
      typeof task?.title === 'string' && task.title.trim().length > 0
        ? task.title.trim()
        : 'Untitled task';

    let projectId: string | null = null;
    const featureId =
      typeof task?.feature_id === 'string' ? task.feature_id : null;
    if (featureId) {
      const { data, error } = await this.db
        .from('roadmap_features')
        .select(
          'epic:roadmap_epics!roadmap_features_epic_id_fkey(roadmap:roadmaps!roadmap_epics_roadmap_id_fkey(project_id))',
        )
        .eq('id', featureId)
        .maybeSingle();
      if (!error) {
        const row = (data ?? null) as
          | {
              epic: {
                roadmap: { project_id: string | null } | null;
              } | null;
            }
          | null;
        projectId = row?.epic?.roadmap?.project_id ?? null;
      }
    }

    await this.notifications.createNotification({
      user_id: assigneeId,
      project_id: projectId ?? undefined,
      type_name: 'task_assigned',
      actor_id: actorId,
      content: {
        task_id: task?.id ?? null,
        task_title: title,
        message: `You were assigned to "${title}".`,
      },
      link_url:
        projectId && task?.id
          ? `/project/${projectId}/roadmap?taskId=${task.id}`
          : undefined,
    });
  }
}
