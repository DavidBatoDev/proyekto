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
import { RealtimePublisher } from '../../realtime/realtime-publisher.service';

export const TASKS_REPOSITORY = Symbol('TASKS_REPOSITORY');

@Injectable()
export class TasksService {
  constructor(
    @Inject(TASKS_REPOSITORY) private readonly repo: ITasksRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimePublisher,
  ) {}

  private notify(roadmapId: string | null, userId: string): void {
    if (roadmapId) this.realtime.publishRoadmapChange(roadmapId, userId);
  }

  async findByFeature(featureId: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ featureId }, userId);
    return this.repo.findByFeature(featureId);
  }

  async findByRoadmap(roadmapId: string, userId: string) {
    await this.roadmapAuthz.assertCanViewRoadmap(roadmapId, userId);
    return this.repo.findByRoadmap(roadmapId);
  }

  async findById(id: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ taskId: id }, userId);
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
    await this.notifyTaskAssignees(task, this.assigneeIdsOf(task), userId);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    this.notify(
      await this.roadmapAuthz.resolveRoadmapId({ featureId: dto.feature_id }),
      userId,
    );
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
    await this.notifyTaskAssignees(task, this.assigneeIdsOf(task), userId);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    this.notify(
      await this.roadmapAuthz.resolveRoadmapId({ featureId }),
      userId,
    );
    return task;
  }

  async update(id: string, dto: UpdateTaskDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    await this.roadmapAuthz.assertTaskPermission(id, userId, 'roadmap.edit');
    // (Un)assigning members is a distinct capability: a per-user override can
    // grant task editing while withholding roadmap.assign. Only enforce it when
    // the update actually touches an assignee field.
    if (dto.assignee_ids !== undefined || dto.assignee_id !== undefined) {
      await this.roadmapAuthz.assertTaskPermission(id, userId, 'roadmap.assign');
    }
    const task = await this.repo.update(id, dto, userId);
    // Notify only assignees that are newly added by this update.
    const previousAssignees = new Set(this.assigneeIdsOf(existing));
    const newlyAssigned = this.assigneeIdsOf(task).filter(
      (assigneeId) => !previousAssignees.has(assigneeId),
    );
    if (newlyAssigned.length) {
      await this.notifyTaskAssignees(task, newlyAssigned, userId);
    }
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    this.notify(
      await this.roadmapAuthz.resolveRoadmapId({ taskId: id }),
      userId,
    );
    return task;
  }

  async getHistory(id: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ taskId: id }, userId);
    return this.repo.getHistory(id);
  }

  async bulkReorder(featureId: string, dto: BulkReorderDto, userId: string) {
    await this.roadmapAuthz.assertFeaturePermission(
      featureId,
      userId,
      'roadmap.edit_tasks',
    );
    const reordered = await this.repo.bulkReorder(featureId, dto);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    this.notify(
      await this.roadmapAuthz.resolveRoadmapId({ featureId }),
      userId,
    );
    return reordered;
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    await this.roadmapAuthz.assertTaskPermission(
      id,
      userId,
      'roadmap.edit_tasks',
    );
    // The parent feature outlives the task — resolve via it (no post-delete read).
    const featureId =
      typeof existing.feature_id === 'string' ? existing.feature_id : null;
    await this.repo.remove(id);
    await this.cacheInvalidation.invalidatePublicRoadmapTemplatesCache();
    this.notify(
      await this.roadmapAuthz.resolveRoadmapId({ featureId }),
      userId,
    );
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
        throw new Error(
          createEpicErr?.message ?? 'Failed to create default epic',
        );
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

  /** Collects the full assignee id set of a task, tolerating both the legacy
   * single assignee_id and the normalized assignees[] array. */
  private assigneeIdsOf(task: any): string[] {
    const ids = new Set<string>();
    if (Array.isArray(task?.assignees)) {
      for (const a of task.assignees) {
        if (typeof a?.id === 'string') ids.add(a.id);
      }
    }
    if (typeof task?.assignee_id === 'string') ids.add(task.assignee_id);
    return [...ids];
  }

  private async notifyTaskAssignees(
    task: any,
    assigneeIds: string[],
    actorId: string,
  ): Promise<void> {
    const recipients = [...new Set(assigneeIds)].filter(
      (assigneeId) => assigneeId && assigneeId !== actorId,
    );
    if (!recipients.length) return;

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
        const row = (data ?? null) as {
          epic: {
            roadmap: { project_id: string | null } | null;
          } | null;
        } | null;
        projectId = row?.epic?.roadmap?.project_id ?? null;
      }
    }

    for (const assigneeId of recipients) {
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
}
