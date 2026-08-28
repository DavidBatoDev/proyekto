import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { NotificationsService } from '../../../shared/notifications/notifications.service';
import type { ITasksRepository } from '../repositories/tasks.repository.interface';
import {
  CreateTaskDto,
  QuickCreateTaskFromTimerDto,
  UpdateTaskDto,
  BulkReorderDto,
} from '../dto/roadmaps.dto';
import {
  RoadmapAuthorizationService,
  type TaskWriteContext,
} from './roadmap-authorization.service';
import { getPermission } from '../../projects/permissions/project-permissions';
import { MissingPermissionException } from '../../projects/authorization/missing-permission.exception';
import { RoadmapWriteEffects } from './roadmap-write-effects.service';
import { RoadmapActivityService } from './roadmap-activity.service';
import { ACTIVITY_ACTIONS } from '../../../shared/audit/activity-actions';
import { FeatureStatusSyncService } from './derive-feature-status';

export const TASKS_REPOSITORY = Symbol('TASKS_REPOSITORY');

const TASK_TRACKED_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'due_date',
  'feature_id',
  'work_type',
];

@Injectable()
export class TasksService {
  constructor(
    @Inject(TASKS_REPOSITORY) private readonly repo: ITasksRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly notifications: NotificationsService,
    private readonly effects: RoadmapWriteEffects,
    private readonly activity: RoadmapActivityService,
    private readonly featureStatusSync: FeatureStatusSyncService,
  ) {}

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
    const ctx = await this.roadmapAuthz.assertFeaturePermission(
      dto.feature_id,
      userId,
      'roadmap.create_tasks',
    );
    const task = await this.repo.create(dto, userId);
    await this.notifyTaskAssignees(task, this.assigneeIdsOf(task), userId);
    await this.featureStatusSync.syncAfterTaskChange(dto.feature_id);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_CREATED,
      entityType: 'task',
      entityId: (task as { id?: string })?.id ?? null,
      title: dto.title,
      metadata: { parent: { type: 'feature', id: dto.feature_id } },
    });
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
    await this.featureStatusSync.syncAfterTaskChange(featureId);
    // ensureTimerFeature just resolved (or created) the roadmap chain, so this
    // is the one place a lookup is genuinely still needed.
    const roadmapId = await this.roadmapAuthz.resolveRoadmapId({ featureId });
    this.effects.emit(
      {
        roadmapId: roadmapId as string,
        projectId: dto.project_id,
        ownerId: null,
        permissions: null,
      },
      userId,
      {
        action: ACTIVITY_ACTIONS.TASK_CREATED,
        entityType: 'task',
        entityId: (task as { id?: string })?.id ?? null,
        title: dto.title.trim(),
        metadata: {
          source: 'timer',
          parent: { type: 'feature', id: featureId },
        },
      },
    );
    return task;
  }

  async update(id: string, dto: UpdateTaskDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    const ctx = await this.roadmapAuthz.assertTaskPermission(
      id,
      userId,
      'roadmap.edit',
    );
    // (Un)assigning members is a distinct capability: a per-user override can
    // grant task editing while withholding roadmap.assign. Only enforce it when
    // the update actually touches an assignee field — and answer it from the
    // permission set the walk above already resolved rather than re-walking.
    if (dto.assignee_ids !== undefined || dto.assignee_id !== undefined) {
      this.assertAssignCapability(ctx);
    }
    const movingFeature =
      dto.feature_id !== undefined && dto.feature_id !== existing.feature_id;
    if (movingFeature) {
      const targetCtx = await this.roadmapAuthz.assertFeaturePermission(
        dto.feature_id as string,
        userId,
        'roadmap.create_tasks',
      );
      if (targetCtx.roadmapId !== ctx.roadmapId) {
        throw new NotFoundException('Feature not found');
      }
    }
    const task = await this.repo.update(id, dto, userId);
    // A cross-feature move affects the derived status of both the feature the
    // task left and the one it landed in.
    await this.featureStatusSync.syncAfterTaskChange(task.feature_id);
    if (movingFeature) {
      await this.featureStatusSync.syncAfterTaskChange(existing.feature_id);
    }
    // Notify only assignees that are newly added by this update.
    const previousAssignees = new Set(this.assigneeIdsOf(existing));
    const currentAssignees = this.assigneeIdsOf(task);
    const newlyAssigned = currentAssignees.filter(
      (assigneeId) => !previousAssignees.has(assigneeId),
    );
    if (newlyAssigned.length) {
      await this.notifyTaskAssignees(task, newlyAssigned, userId);
    }

    // ONE row for the whole PATCH, action picked by precedence
    // (assignment > status > move > generic) with the full diff attached.
    const changes = this.activity.diff(existing, task, TASK_TRACKED_FIELDS);
    const assigneesChanged =
      currentAssignees.length !== previousAssignees.size ||
      currentAssignees.some((a) => !previousAssignees.has(a));
    this.effects.emit(ctx, userId, {
      action: this.activity.taskUpdateAction({
        assigneesChanged,
        assigneesAdded: newlyAssigned.length,
        statusChanged: changes.some((c) => c.field === 'status'),
        featureChanged: changes.some((c) => c.field === 'feature_id'),
      }),
      entityType: 'task',
      entityId: id,
      title: (task as { title?: string })?.title ?? existing.title,
      metadata: {
        changes,
        ...(assigneesChanged
          ? { assignees: this.activity.assigneeSummary(currentAssignees) }
          : {}),
      },
    });
    return task;
  }

  /**
   * In-memory `roadmap.assign` check against an already-resolved context.
   * A personal roadmap has no permission set — reaching here means the owner
   * check in the authz walk already passed, so assignment is allowed.
   */
  private assertAssignCapability(ctx: TaskWriteContext): void {
    if (!ctx.permissions) return;
    if (!getPermission(ctx.permissions, 'roadmap.assign')) {
      throw new MissingPermissionException({ path: 'roadmap.assign' });
    }
  }

  async getHistory(id: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ taskId: id }, userId);
    return this.repo.getHistory(id);
  }

  /**
   * Clones a single task, inserted immediately after the source in the same
   * feature. Trailing siblings are bumped via bulkReorder (same as the
   * drag-reorder path) before creating the clone at the freed position;
   * board_order always auto-appends to the end of its Kanban column
   * regardless (see TasksRepositorySupabase.create), which is the desired
   * default here too.
   */
  async duplicate(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    const ctx = await this.roadmapAuthz.assertTaskPermission(
      id,
      userId,
      'roadmap.create_tasks',
    );

    const insertPosition = (existing.position ?? 0) + 1;
    const siblings = await this.repo.findByFeature(existing.feature_id);
    const toShift = siblings.filter(
      (task) => (task.position ?? 0) >= insertPosition,
    );
    if (toShift.length) {
      await this.repo.bulkReorder(existing.feature_id, {
        items: toShift.map((task) => ({
          id: task.id,
          position: (task.position as number) + 1,
        })),
      });
    }

    const clonedTask = await this.repo.create(
      {
        feature_id: existing.feature_id,
        title: `${existing.title} (Copy)`,
        description: existing.description ?? undefined,
        priority: existing.priority ?? undefined,
        status: existing.status ?? undefined,
        due_date: existing.due_date ?? undefined,
        position: insertPosition,
        work_type: existing.work_type ?? undefined,
        checklist: existing.checklist ?? undefined,
      },
      userId,
    );
    await this.featureStatusSync.syncAfterTaskChange(existing.feature_id);

    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_DUPLICATED,
      entityType: 'task',
      entityId: (clonedTask as { id?: string })?.id ?? null,
      title: (clonedTask as { title?: string })?.title ?? null,
      metadata: {
        parent: { type: 'feature', id: existing.feature_id },
        source_task_id: id,
      },
    });

    return clonedTask;
  }

  async bulkReorder(featureId: string, dto: BulkReorderDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertFeaturePermission(
      featureId,
      userId,
      'roadmap.edit_tasks',
    );
    const reordered = await this.repo.bulkReorder(featureId, dto);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_REORDERED,
      entityType: 'task',
      metadata: this.activity.reorderMetadata({
        scopeType: 'feature',
        scopeId: featureId,
        itemCount: dto.items?.length ?? 0,
        moved: dto.items?.map((i) => ({ id: i.id, position: i.position })),
      }),
    });
    return reordered;
  }

  async bulkReorderByStatus(
    roadmapId: string,
    status: string,
    dto: BulkReorderDto,
    userId: string,
  ) {
    const ctx = await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit_tasks',
    );
    const reordered = await this.repo.bulkReorderByStatus(
      roadmapId,
      status,
      dto,
    );
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_REORDERED,
      entityType: 'task',
      metadata: {
        ...this.activity.reorderMetadata({
          scopeType: 'roadmap',
          scopeId: roadmapId,
          itemCount: dto.items?.length ?? 0,
          moved: dto.items?.map((i) => ({ id: i.id, position: i.position })),
        }),
        // Board reorders are scoped to one Kanban column.
        board_status: status,
      },
    });
    return reordered;
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Task not found');
    // The authz walk resolves the owning roadmap before the delete, so the
    // notify target survives the row going away.
    const ctx = await this.roadmapAuthz.assertTaskPermission(
      id,
      userId,
      'roadmap.edit_tasks',
    );
    await this.repo.remove(id);
    await this.featureStatusSync.syncAfterTaskChange(existing.feature_id);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_DELETED,
      entityType: 'task',
      entityId: id,
      title: (existing as { title?: string })?.title ?? null,
    });
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
